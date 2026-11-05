"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { type AgeMode } from "@/shared/config";
import { getSession } from "@/modules/accounts";
import { effective } from "@/modules/settings";
import { textByMode } from "@/modules/library";
import { getMission } from "./queries";
import { canTransition, type MissionStatus } from "./state-machine";
import fixedQuestions from "@content/fixed_questions.ar.json";
import contextTags from "@content/context_tags.ar.json";
import { createAdminClient } from "@/shared/db/admin";
import { aiEnabled, anthropicCaller, normalizeStrategy } from "@/modules/companion";
import { showMemoryInPlanning, recallLine } from "@/modules/adaptation";
import { loadStrategyOutcomes, strategyLabelFor } from "@/modules/adaptation/service";
import { completeCore, interruptCore, resumeCore, abandonCore, reflectCore, mapMissionError, type CoreCtx } from "./core";

export type MissionActionResult = { ok: true; data?: unknown } | { ok: false; error: string };
const uuid = z.string().uuid();

async function transition(missionId: string, to: MissionStatus, meta: Record<string, unknown> = {}) {
  const db = await createClient();
  const { error } = await db.rpc("transition_mission", { p_mission_id: missionId, p_to: to, p_meta: meta });
  if (error) return mapErr(error.message);
  return null;
}

async function loadOwned(missionId: string) {
  const s = await getSession();
  const found = await getMission(missionId);
  if (!s?.profile || !found || found.mission.profile_id !== s.profile.id) return null;
  return { ...found, mode: s.profile.age_mode as AgeMode, profileId: s.profile.id };
}
async function ctxFor(m: NonNullable<Awaited<ReturnType<typeof loadOwned>>>): Promise<CoreCtx> {
  return { db: await createClient(), admin: createAdminClient, profileId: m.profileId, mode: m.mode };
}

/** suggested → chosen (مع غاية اختيارية). 5.2 خطوة 2 */
export async function chooseMission(_: unknown, form: FormData): Promise<MissionActionResult> {
  const p = z.object({ mission_id: uuid, goal_id: uuid.optional().or(z.literal("")) }).safeParse({ mission_id: form.get("mission_id"), goal_id: form.get("goal_id") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const m = await loadOwned(p.data.mission_id);
  if (!m) return { ok: false, error: "not_found" };
  if (!canTransition(m.mission.status, "chosen")) return { ok: false, error: "bad_state" };
  const db = await createClient();
  if (p.data.goal_id) await db.from("missions").update({ goal_id: p.data.goal_id }).eq("id", m.mission.id);
  const err = await transition(m.mission.id, "chosen", { goal_id: p.data.goal_id || null });
  if (err) return { ok: false, error: err };
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** 5.2 خطوة 2: استبدال اقتراح — يُعلَّم dismissed ويُولَّد بديل عند العودة للرئيسية. */
export async function dismissSuggestion(_: unknown, form: FormData): Promise<MissionActionResult> {
  const id = String(form.get("mission_id"));
  const m = await loadOwned(id);
  if (!m || m.mission.status !== "suggested") return { ok: false, error: "bad_state" };
  const db = await createClient();
  const { error } = await db.from("missions").update({ dismissed: true }).eq("id", id);
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app", "layout");
  redirect("/app");
}

/** MIS-3: التخطيط — استراتيجية (أو مخصصة)، تقدير وقت، توقع. chosen → planned */
export async function planMission(_: unknown, form: FormData): Promise<MissionActionResult> {
  const p = z.object({
    mission_id: uuid,
    strategy_id: z.string().optional().or(z.literal("")),
    custom_strategy: z.string().trim().max(300).optional().or(z.literal("")),
    time_estimate: z.coerce.number().int().positive().max(600),
    prediction: z.coerce.number().positive().max(1000).optional(),
    context_tag: z.enum(Object.keys(contextTags).filter((k) => !k.startsWith("_")) as [string, ...string[]]).optional(),
  }).safeParse({
    mission_id: form.get("mission_id"), strategy_id: form.get("strategy_id") ?? "", custom_strategy: form.get("custom_strategy") ?? "",
    time_estimate: form.get("time_estimate"), prediction: form.get("prediction") || undefined, context_tag: form.get("context_tag") || undefined,
  });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const m = await loadOwned(p.data.mission_id);
  if (!m) return { ok: false, error: "not_found" };
  if (!canTransition(m.mission.status, "planned")) return { ok: false, error: "bad_state" };
  const custom = p.data.custom_strategy || null;
  const strategyId = custom ? null : p.data.strategy_id || null;
  if (!custom && !m.template.strategies.some((s) => s.id === strategyId)) return { ok: false, error: "strategy_required" };
  if (m.template.prediction_prompt && p.data.prediction === undefined) return { ok: false, error: "prediction_required" };
  const db = await createClient();
  let label: string | null = custom ? "custom" : null;
  if (custom && aiEnabled()) { try { label = await normalizeStrategy({ db: createAdminClient(), caller: anthropicCaller(), profileId: m.profileId, mode: m.mode, mechanic: m.template.mechanic, strategy: custom }); } catch { /* السقوط custom */ } }
  const { error } = await db.from("missions").update({
    strategy_chosen: strategyId, custom_strategy: custom, custom_strategy_label: label,
    time_estimate: p.data.time_estimate,
    context_tag: m.template.training_level === "simulated" ? "in_app" : (p.data.context_tag ?? "other"),
    prediction: m.template.prediction_prompt ? (m.template.evidence_rules.some((r) => r.value.kind === "prediction_error") && /دقيقة/.test(textByMode(m.template.prediction_prompt, m.mode)) ? { minutes: p.data.prediction } : { count: p.data.prediction }) : null,
  }).eq("id", m.mission.id);
  if (error) return { ok: false, error: mapErr(error.message) };
  const err = await transition(m.mission.id, "planned", { strategy: strategyId ?? "custom" });
  if (err) return { ok: false, error: err };
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function startMission(_: unknown, form: FormData): Promise<MissionActionResult> {
  const id = String(form.get("mission_id"));
  const m = await loadOwned(id);
  if (!m || !canTransition(m.mission.status, "in_progress")) return { ok: false, error: "bad_state" };
  const err = await transition(id, "in_progress");
  if (err) return { ok: false, error: err };
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** MIS-6: زر "توقفت" */
export async function interruptMission(_: unknown, form: FormData): Promise<MissionActionResult> {
  const id = String(form.get("mission_id"));
  const m = await loadOwned(id);
  if (!m) return { ok: false, error: "bad_state" };
  const r = await interruptCore(await ctxFor(m), m);
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

/** MIS-6: العودة بعد التوقف مع سؤال واحد: ما الذي أوقفك؟ */
export async function resumeMission(_: unknown, form: FormData): Promise<MissionActionResult> {
  const p = z.object({ mission_id: uuid, reason: z.string().trim().max(300) }).safeParse({ mission_id: form.get("mission_id"), reason: form.get("reason") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const m = await loadOwned(p.data.mission_id);
  if (!m) return { ok: false, error: "bad_state" };
  const r = await resumeCore(await ctxFor(m), m, { reason: p.data.reason });
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

/** MIS-5: نتيجة خيار المشتت تُسجَّل ولا تُعاقَب */
export async function logDistraction(_: unknown, form: FormData): Promise<MissionActionResult> {
  const p = z.object({ mission_id: uuid, choice: z.enum(["ignore", "break_return", "give_in"]) }).safeParse({ mission_id: form.get("mission_id"), choice: form.get("choice") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const m = await loadOwned(p.data.mission_id);
  if (!m || m.mission.status !== "in_progress") return { ok: false, error: "bad_state" };
  const max = m.template.distraction_config?.count ?? 0;
  if (m.mission.distraction_log.length >= max) return { ok: false, error: "no_more_distractions" };
  const db = await createClient();
  const { error } = await db.from("missions").update({ distraction_log: [...m.mission.distraction_log, { at: new Date().toISOString(), choice: p.data.choice }] }).eq("id", m.mission.id);
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** MIS-11: "أحتاج تلميحًا" يزيد hints_used ويعيد التلميح حسب مستوى الدعم */
export async function useHint(_: unknown, form: FormData): Promise<MissionActionResult> {
  const id = String(form.get("mission_id"));
  const m = await loadOwned(id);
  if (!m || !["planned", "in_progress", "interrupted"].includes(m.mission.status)) return { ok: false, error: "bad_state" };
  const hints = m.template.hints_by_level[m.mission.support_level] ?? [];
  if (hints.length === 0) return { ok: false, error: "no_hints_at_this_level" };
  const db = await createClient();
  const next = m.mission.hints_used + 1;
  const { error } = await db.from("missions").update({ hints_used: next }).eq("id", id);
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, data: hints[Math.min(next - 1, hints.length - 1)] };
}

export async function toggleChecklistItem(_: unknown, form: FormData): Promise<MissionActionResult> {
  const p = z.object({ mission_id: uuid, index: z.coerce.number().int().nonnegative() }).safeParse({ mission_id: form.get("mission_id"), index: form.get("index") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const m = await loadOwned(p.data.mission_id);
  if (!m || m.mission.status !== "in_progress") return { ok: false, error: "bad_state" };
  const set = new Set(m.mission.checklist_done);
  if (set.has(p.data.index)) set.delete(p.data.index); else set.add(p.data.index);
  const db = await createClient();
  await db.from("missions").update({ checklist_done: [...set].sort() }).eq("id", m.mission.id);
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** GATE-1: البوابة الأولى تُحسم آليًا من completion_check (الجوهر في core.ts، مشترك مع المزامنة) */
export async function completeMission(_: unknown, form: FormData): Promise<MissionActionResult> {
  const p = z.object({ mission_id: uuid, actual_duration_min: z.coerce.number().int().positive().optional() }).safeParse({ mission_id: form.get("mission_id"), actual_duration_min: form.get("actual_duration_min") || undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const m = await loadOwned(p.data.mission_id);
  if (!m) return { ok: false, error: "bad_state" };
  const r = await completeCore(await ctxFor(m), m, { actual_duration_min: p.data.actual_duration_min });
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export async function abandonMission(_: unknown, form: FormData): Promise<MissionActionResult> {
  const id = String(form.get("mission_id"));
  const m = await loadOwned(id);
  if (!m) return { ok: false, error: "bad_state" };
  const r = await abandonCore(await ctxFor(m), m);
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

/** أسئلة التأمل لمهمة: أسئلة القالب ثم الثابتة حتى الحد المضبوط (reflection_max_questions). */
export async function reflectionPromptsFor(missionId: string, asStatus?: "completed" | "abandoned"): Promise<string[]> {
  const m = await loadOwned(missionId);
  if (!m) return [];
  const db = await createClient();
  const max = (await effective<number>(db, m.profileId, "reflection_max_questions")).value;
  const own = m.template.reflection_prompts.map((q) => textByMode(q, m.mode));
  const extra = (asStatus ?? m.mission.status) === "abandoned" ? fixedQuestions.reflection_after_abandon[m.mode] : [];
  const general = fixedQuestions.reflection_general[m.mode];
  // 4.13.2: عند L2–L3 يُستحضر آخر استخدام للاستراتيجية كسؤال أول في التأمل
  let recall: string[] = [];
  if (!showMemoryInPlanning(m.mission.support_level)) {
    const rows = await loadStrategyOutcomes(db, m.profileId);
    const line = recallLine(rows, m.template.mechanic, m.mode, (k) => strategyLabelFor(k, m.template.strategies, m.mode, rows));
    if (line) recall = [line];
  }
  return [...recall, ...extra, ...own, ...general].slice(0, max);
}

/** التأمل: completed/abandoned → reflected ثم التقييم (الجوهر في core.ts). */
export async function submitReflection(_: unknown, form: FormData): Promise<MissionActionResult> {
  const id = String(form.get("mission_id"));
  const m = await loadOwned(id);
  if (!m) return { ok: false, error: "bad_state" };
  const r = await reflectCore(await ctxFor(m), m, { prompts: form.getAll("prompt").map(String), answers: form.getAll("answer").map(String) });
  if (!r.ok) return r;
  revalidatePath("/app", "layout");
  redirect(`/app/missions/${id}`);
}

const mapErr = mapMissionError;
