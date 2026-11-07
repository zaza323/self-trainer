/**
 * نقاط المخطط (0.4 ب.8، ج.8، د.7، ز.5، ط.8) — قواعد نقية. لا نقاط على عدد المهام المنجزة؛ النقاط على الالتزام بالخطة والتقدير
 * وعلى التسجيل الصادق. كل القيم من config/game.json.xp.
 */
import { game } from "@/shared/config";

const r = game.xp.rewards;
const pr = game.xp.planner_rules;

export type PlannerXpReason =
  | "planner_estimate_kept" | "planner_block_kept" | "focus_session_done" | "habit_checkin" | "weekly_review_done"
  | "daily_plan_set" | "evening_review_done" | "followup_checkin" | "transition_started" | "muhasaba_done"
  | "day_reconstructed" | "mirror_reviewed";

export type PlannerXpAward = { reason: PlannerXpReason; amount: number; source_id: string };

/** ±tolerance من التقدير (ب.8). */
export function estimateKept(estimateMin: number | null, actualMin: number | null): boolean {
  if (!estimateMin || actualMin === null || actualMin === undefined) return false;
  return Math.abs(actualMin - estimateMin) / estimateMin <= pr.estimate_tolerance;
}

/** أُنجزت داخل كتلتها الزمنية. */
export function blockKept(completedAt: Date, block: { starts_at: string; ends_at: string } | null): boolean {
  if (!block) return false;
  const t = completedAt.getTime();
  return t >= new Date(block.starts_at).getTime() && t <= new Date(block.ends_at).getTime();
}

/** إنجاز مهمة مخطط: لا XP إلا بشرط التقدير أو الكتلة (معيار قبول المرحلة 10). */
export function taskCompletionXp(i: { taskId: string; estimateMin: number | null; actualMin: number | null; completedAt: Date; block: { starts_at: string; ends_at: string } | null }): PlannerXpAward[] {
  const out: PlannerXpAward[] = [];
  if (pr.task_completion_count_xp > 0) out.push({ reason: "planner_estimate_kept", amount: pr.task_completion_count_xp, source_id: `count:${i.taskId}` });
  if (estimateKept(i.estimateMin, i.actualMin)) out.push({ reason: "planner_estimate_kept", amount: r.planner_estimate_kept, source_id: i.taskId });
  if (blockKept(i.completedAt, i.block)) out.push({ reason: "planner_block_kept", amount: r.planner_block_kept, source_id: i.taskId });
  return out;
}

/** الحدود اليومية لكل سبب (من config). alreadyToday = عدد صفوف XP بهذا السبب اليوم. */
export function dailyLimitFor(reason: PlannerXpReason): number {
  switch (reason) {
    case "focus_session_done": return pr.focus_sessions_max_per_day;
    case "habit_checkin": return pr.habit_checkins_max_per_day;
    case "followup_checkin": return pr.followup_checkin_max_per_day;
    case "transition_started": return pr.transition_started_max_per_day;
    case "daily_plan_set": case "evening_review_done": case "muhasaba_done": case "day_reconstructed": return 1;
    default: return Number.MAX_SAFE_INTEGER;
  }
}

export function amountFor(reason: PlannerXpReason): number { return r[reason]; }

/** ز.5: muhasaba_done يحل محل evening_review_done في اليوم نفسه. */
export function muhasabaReplacesEvening(): boolean { return pr.muhasaba_replaces_evening_review_xp_same_day; }

/** د.7 مبدأ الصدق: أي رد في «تمّت؟» يأخذ النقطة نفسها، «ما صارت» ضمنًا. */
export function followupCheckinSameXp(): boolean { return pr.followup_same_xp_any_answer; }
