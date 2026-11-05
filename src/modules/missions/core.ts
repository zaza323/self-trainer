import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limits, type AgeMode } from "@/shared/config";
import { evaluateAndRecord } from "@/modules/evidence";
import { afterMissionReflected } from "@/modules/game";
import { evaluateRewardTriggers } from "@/modules/rewards";
import { scheduleTransferInvite } from "@/modules/life";
import { recomputeStrategyOutcomes } from "@/modules/adaptation/service";
import { track } from "@/modules/trial";
import type { MissionTemplate } from "@/modules/library";
import { canTransition, type MissionStatus } from "./state-machine";
import type { MissionRow } from "./types";

/**
 * جوهر انتقالات المهمة المشترك بين إجراءات الخادم (متصل) ومسار المزامنة (/api/sync بعد العمل دون اتصال).
 * الإدخال كائن عادي لا FormData؛ `clientAt` وقت الحدث على الجهاز (الحالات الحدية: حدود اليوم بوقت الحدث).
 */
export type MissionCoreResult = { ok: true; data?: unknown } | { ok: false; error: string };
export type CoreCtx = { db: SupabaseClient; admin: () => SupabaseClient; profileId: string; mode: AgeMode; clientAt?: string; now?: () => number };
export type Found = { mission: MissionRow; template: MissionTemplate };

export function mapMissionError(msg: string) {
  if (/not allowed/.test(msg)) return "bad_state";
  if (/frozen/.test(msg)) return "frozen";
  if (/row-level security/.test(msg)) return "not_allowed";
  return msg;
}

async function transition(ctx: CoreCtx, missionId: string, to: MissionStatus, meta: Record<string, unknown> = {}) {
  const { error } = await ctx.db.rpc("transition_mission", { p_mission_id: missionId, p_to: to, p_meta: ctx.clientAt ? { ...meta, client_at: ctx.clientAt } : meta });
  return error ? mapMissionError(error.message) : null;
}

/** GATE-1: البوابة الأولى تُحسم آليًا من completion_check. */
export async function completeCore(ctx: CoreCtx, f: Found, input: { actual_duration_min?: number }): Promise<MissionCoreResult> {
  if (!canTransition(f.mission.status, "completed")) return { ok: false, error: "bad_state" };
  const check = f.template.completion_check;
  const now = ctx.clientAt ? Date.parse(ctx.clientAt) : (ctx.now ?? Date.now)();
  if (check === "timer") {
    const elapsedMin = f.mission.started_at ? (now - Date.parse(f.mission.started_at)) / 60000 : 0;
    if (elapsedMin + limits.reflection.min_answer_chars * 0 + 0.1 < f.template.min_duration) return { ok: false, error: "timer_not_finished" };
  }
  if (check === "checklist") {
    const total = f.template.checklist?.length ?? 0;
    if (f.mission.checklist_done.length < total) return { ok: false, error: "checklist_incomplete" };
  }
  if (check === "guardian_confirm" || check === "photo") return { ok: false, error: "completion_check_not_available_yet" };
  if (input.actual_duration_min) await ctx.db.from("missions").update({ actual_duration_min: input.actual_duration_min }).eq("id", f.mission.id);
  const err = await transition(ctx, f.mission.id, "completed", { check });
  return err ? { ok: false, error: err } : { ok: true };
}

/** MIS-6: زر "توقفت" */
export async function interruptCore(ctx: CoreCtx, f: Found): Promise<MissionCoreResult> {
  if (!canTransition(f.mission.status, "interrupted")) return { ok: false, error: "bad_state" };
  const err = await transition(ctx, f.mission.id, "interrupted");
  return err ? { ok: false, error: err } : { ok: true };
}

/** MIS-6: العودة بعد التوقف مع سؤال واحد. */
export async function resumeCore(ctx: CoreCtx, f: Found, input: { reason: string }): Promise<MissionCoreResult> {
  if (!canTransition(f.mission.status, "in_progress")) return { ok: false, error: "bad_state" };
  await ctx.db.from("missions").update({ interruption_reasons: [...f.mission.interruption_reasons, { at: ctx.clientAt ?? new Date().toISOString(), reason: input.reason }] }).eq("id", f.mission.id);
  const err = await transition(ctx, f.mission.id, "in_progress", { reason: input.reason });
  return err ? { ok: false, error: err } : { ok: true };
}

export async function abandonCore(ctx: CoreCtx, f: Found): Promise<MissionCoreResult> {
  if (!canTransition(f.mission.status, "abandoned")) return { ok: false, error: "bad_state" };
  const err = await transition(ctx, f.mission.id, "abandoned");
  return err ? { ok: false, error: err } : { ok: true };
}

/**
 * التأمل: completed/abandoned → reflected ثم التقييم (أدلة، بوابة 2، لعبة، مكافآت، دعوة التعميم) بصلاحيات الخدمة.
 * إدراج التأمل والأدلة وXP كلها idempotent (قيود فريدة + upsert)، فإعادة التطبيق لا تكرر شيئًا.
 */
export async function reflectCore(ctx: CoreCtx, f: Found, input: { prompts: string[]; answers: string[] }): Promise<MissionCoreResult> {
  if (!canTransition(f.mission.status, "reflected")) return { ok: false, error: "bad_state" };
  if (input.prompts.length === 0 || input.prompts.length !== input.answers.length) return { ok: false, error: "invalid_input" };
  if (input.answers.some((a) => a.trim().length < limits.reflection.min_answer_chars)) return { ok: false, error: "answer_required" };
  const { error } = await ctx.db.from("reflections").insert({ mission_id: f.mission.id, prompts_and_answers: input.prompts.map((prompt, i) => ({ prompt, answer: input.answers[i]!.trim() })) });
  if (error && !/duplicate key/.test(error.message)) return { ok: false, error: mapMissionError(error.message) };
  const err = await transition(ctx, f.mission.id, "reflected");
  if (err) return { ok: false, error: err };
  try {
    const admin = ctx.admin();
    await evaluateAndRecord(admin, f.mission.id);
    await afterMissionReflected(admin, f.mission.id);
    await evaluateRewardTriggers(admin, ctx.profileId);
    await scheduleTransferInvite(admin, ctx.profileId, f.mission.id, f.template.training_level);
    await recomputeStrategyOutcomes(admin, ctx.profileId); // ADAPT-3
    const { data: done } = await admin.from("missions").select("gate1, gate2").eq("id", f.mission.id).maybeSingle();
    await track(admin, { event: "mission_reflected", profileId: ctx.profileId, props: { age_mode: ctx.mode, training_level: f.template.training_level, mechanic: f.template.mechanic, gate1: Boolean((done as { gate1?: boolean } | null)?.gate1), gate2: String((done as { gate2?: string } | null)?.gate2 ?? "") } });
  } catch (e) {
    console.error("evaluation failed", e);
    return { ok: false, error: "evaluation_failed" };
  }
  return { ok: true };
}

export type ClientOpKind = "complete" | "interrupt" | "resume" | "reflect" | "abandon";
/** توجيه عملية عميل (من طابور المزامنة) إلى جوهرها. */
export async function applyCore(ctx: CoreCtx, f: Found, kind: ClientOpKind, payload: Record<string, unknown>): Promise<MissionCoreResult> {
  switch (kind) {
    case "complete": return completeCore(ctx, f, { actual_duration_min: typeof payload.actual_duration_min === "number" ? payload.actual_duration_min : undefined });
    case "interrupt": return interruptCore(ctx, f);
    case "resume": return resumeCore(ctx, f, { reason: String(payload.reason ?? "") });
    case "abandon": return abandonCore(ctx, f);
    case "reflect": return reflectCore(ctx, f, { prompts: (payload.prompts as string[]) ?? [], answers: (payload.answers as string[]) ?? [] });
  }
}
