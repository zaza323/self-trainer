import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode, CapabilityId, SupportLevel } from "@/shared/config";
import { support as supportCfg } from "@/shared/config";
import type { EvidenceType, EvidenceSource } from "@/modules/evidence/rules";
import { createCustomTemplate } from "@/modules/life/service";
import { primaryCapability } from "@/modules/library";
import { effective } from "@/modules/settings";
import { localParts } from "@/modules/notifications/plan";
import { recordPlannerEvidence } from "./evidence-service";
import { awardTaskCompletionXp } from "./xp-service";
import { bridgeConfig, p1Value, p2Value, p3Value, p4Value, p5Value, convertedTrainingLevel, overdueToReschedule, autoRescheduleAgeModes } from "./bridge";
import type { PlannerTaskRow } from "./types";

type Db = SupabaseClient;
/** age_mode قد يكون null في صف الملف العام؛ المتدرب له وضع دائمًا، وإلا لا أدلة. */
export type BridgeProfile = { id: string; age_mode: AgeMode | null; timezone: string };
const R = bridgeConfig.rules;

/** سياق الدليل من مشروع المهمة (ب.11) ⇒ يدعم novel_context. */
export async function contextTagFor(admin: Db, task: Pick<PlannerTaskRow, "project_id">): Promise<string> {
  if (!task.project_id) return "planner";
  const { data } = await admin.from("planner_projects").select("context_tag").eq("id", task.project_id).maybeSingle();
  return ((data as { context_tag: string | null } | null)?.context_tag || "planner").trim() || "planner";
}

async function record(admin: Db, p: BridgeProfile, rule: keyof typeof R, value: number | null, task: Pick<PlannerTaskRow, "id" | "project_id">, now: Date, dedupe?: string): Promise<boolean> {
  if (value === null || !p.age_mode) return false;
  const r = R[rule];
  return recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: rule, capability: r.capability as CapabilityId, type: r.type as EvidenceType, source: r.source as EvidenceSource, value, contextTag: await contextTagFor(admin, task), plannerTaskId: task.id, dedupeKey: dedupe ?? task.id }, now);
}

/** بعد إنجاز مهمة (من القائمة أو من «تمّت؟»): XP بشرط التقدير/الكتلة + P1 + P3. */
export async function afterTaskCompleted(admin: Db, p: BridgeProfile, task: PlannerTaskRow, now = new Date()): Promise<{ xp: number; evidence: string[] }> {
  const xp = await awardTaskCompletionXp(admin, task, now);
  const evidence: string[] = [];
  if (await record(admin, p, "P1", p1Value(task), task, now)) evidence.push("P1");
  if (await record(admin, p, "P3", p3Value(task), task, now)) evidence.push("P3");
  return { xp, evidence };
}

/** بعد إلغاء واعٍ (P5). */
export async function afterTaskCancelled(admin: Db, p: BridgeProfile, task: PlannerTaskRow, now = new Date()): Promise<boolean> {
  return record(admin, p, "P5", p5Value(task), task, now);
}

/** «تشتّت» في التركيز ثم جواب «رجعت؟» (P2). */
export async function afterDistraction(admin: Db, p: BridgeProfile, i: { sessionId: string; taskId: string | null; returned: boolean | null; distractionNo: number }, now = new Date()): Promise<boolean> {
  const task = i.taskId ? ((await admin.from("planner_tasks").select("id, project_id, auto_rescheduled").eq("id", i.taskId).maybeSingle()).data as { id: string; project_id: string | null; auto_rescheduled: boolean } | null) : null;
  if (task?.auto_rescheduled) return false;
  return record(admin, p, "P2", p2Value(i.returned), { id: task?.id ?? (null as unknown as string), project_id: task?.project_id ?? null }, now, `${i.sessionId}:${i.distractionNo}`);
}

export async function planningLevel(admin: Db, p: BridgeProfile): Promise<SupportLevel> {
  const cap = (bridgeConfig as unknown as { capability_for_support_level?: string }).capability_for_support_level ?? "planning";
  const { data } = await admin.from("capability_states").select("support_level").eq("profile_id", p.id).eq("capability_id", cap).maybeSingle();
  return ((data as { support_level: SupportLevel } | null)?.support_level) ?? supportCfg.initial_by_age_mode[p.age_mode ?? "adult"];
}

/** حفظ تقسيم كتبه المستخدم (P4 عند L2+ بلا task_breakdown). usedAi = أي خطوة أصلها اقتراح النموذج. */
export async function afterUserBreakdown(admin: Db, p: BridgeProfile, task: PlannerTaskRow, i: { userSteps: number; usedAi: boolean }, now = new Date()): Promise<boolean> {
  const level = await planningLevel(admin, p);
  return record(admin, p, "P4", p4Value({ planningLevel: level, userSteps: i.userSteps, usedAi: i.usedAi, autoRescheduled: task.auto_rescheduled }), task, now);
}

/**
 * تحويل مهمة حقيقية إلى تدريب (ب.11): مهمة source=planner بمستوى guided_real أو independent_real حسب مستوى تدريب القدرة،
 * مربوطة بـ planner_task_id. إنجاز مهمة التدريب يُنجز المهمة الحقيقية (محفز في الهجرة 0015).
 */
export async function convertTaskToMission(admin: Db, p: BridgeProfile, task: PlannerTaskRow, i: { createdBy: string; mechanic?: string | null; weights?: Record<string, number>; prompts?: string[]; now?: Date }): Promise<{ ok: true; missionId: string } | { ok: false; error: string }> {
  if (task.status !== "open") return { ok: false, error: "bad_state" };
  if (!p.age_mode) return { ok: false, error: "not_allowed" };
  const mode = p.age_mode;
  const { data: existing } = await admin.from("missions").select("id").eq("planner_task_id", task.id).in("status", ["suggested", "chosen", "planned", "in_progress", "interrupted"]).limit(1);
  if (existing?.length) return { ok: true, missionId: (existing[0] as { id: string }).id };
  const cfg = bridgeConfig.convert_to_mission;
  const mechanic = (i.mechanic ?? cfg.default_mechanic) as Parameters<typeof createCustomTemplate>[1]["mechanic"];
  const primary = i.weights && Object.keys(i.weights).length ? primaryCapability({ capability_weights: i.weights }) || null : null;
  const capForLevel = primary ?? "planning";
  const { data: st } = await admin.from("capability_states").select("training_level, support_level").eq("profile_id", p.id).eq("capability_id", capForLevel).maybeSingle();
  const state = st as { training_level: string | null; support_level: SupportLevel } | null;
  const level = convertedTrainingLevel(state?.training_level ?? null);
  const minutes = task.estimate_min ?? cfg.default_minutes;
  const tpl = await createCustomTemplate(admin, { profileId: p.id, mode, createdBy: i.createdBy, title: task.title, situation: task.notes || task.title, mechanic, capabilityWeights: i.weights, reflectionPrompts: i.prompts, trainingLevel: level, minutes });
  const today = localParts(i.now ?? new Date(), p.timezone).date;
  const contextTag = await contextTagFor(admin, task);
  const { data, error } = await admin.from("missions").insert({
    profile_id: p.id, template_id: tpl.id, template_version: tpl.version, status: "suggested", difficulty: 2, support_level: state?.support_level ?? supportCfg.initial_by_age_mode[mode],
    variables: { time_budget: minutes, context: task.title }, source: "planner", needs_approval: false, created_by: i.createdBy, suggested_for: today, context_tag: contextTag, planner_task_id: task.id,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, missionId: (data as { id: string }).id };
}

/** ب.10: إعادة جدولة المتأخر تلقائيًا (adult + الإعداد مفعّل فقط). تُعلَّم auto_rescheduled فتُستثنى من الأدلة. يومي. */
export async function autoRescheduleFor(admin: Db, p: BridgeProfile, now = new Date()): Promise<number> {
  if (!p.age_mode || !autoRescheduleAgeModes.includes(p.age_mode)) return 0;
  if (!(await effective<boolean>(admin, p.id, "overdue_auto_reschedule")).value) return 0;
  const today = localParts(now, p.timezone).date;
  const { data: tasks } = await admin.from("planner_tasks").select("id, status, due_date, parent_task_id").eq("profile_id", p.id).eq("status", "open").lt("due_date", today);
  let moved = 0;
  for (const t of overdueToReschedule((tasks ?? []) as Array<{ id: string; status: string; due_date: string | null; parent_task_id: string | null }>, today)) {
    const { error } = await admin.from("planner_tasks").update({ due_date: today, auto_rescheduled: true }).eq("id", t.id);
    if (!error) moved++;
  }
  return moved;
}
export async function autoRescheduleOverdue(admin: Db, now = new Date()): Promise<{ moved: number }> {
  const { data: profiles } = await admin.from("profiles").select("id, age_mode, timezone").eq("kind", "player").in("age_mode", autoRescheduleAgeModes);
  let moved = 0;
  for (const p of (profiles ?? []) as BridgeProfile[]) moved += await autoRescheduleFor(admin, p, now);
  return { moved };
}
