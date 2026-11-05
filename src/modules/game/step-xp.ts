import { game, SUPPORT_LEVELS, type SupportLevel } from "@/shared/config";
import type { XpAward } from "./xp";

/**
 * تعديل 0.3 §1: نقاط الخطوات أثناء التدريب — دالة نقية.
 * تُمنح عند reflected ما دامت القدرة الأساسية قيد التدريب؛ تتوقف عند L3_free أو الإتقان. source_id = mission_id (وmission_id:n للمشتتات).
 */
export type StepXpInput = {
  missionId: string;
  planned: boolean;           // اختار استراتيجية وقدّر الوقت
  predicted: boolean;         // أجاب سؤال التوقع
  resumed: boolean;           // عاد بعد انقطاع
  distractionsHandled: number; // عدد المشتتات التي تجاهلها أو عاد منها
  primarySupport: SupportLevel;
  primaryMastered: boolean;
};
export type StepXpAward = XpAward & { source_id: string };

export function stepXpStopped(primarySupport: SupportLevel, primaryMastered: boolean): boolean {
  const stop = game.xp.step_rewards.stop_when;
  return (stop.or_mastered && primaryMastered) || SUPPORT_LEVELS.indexOf(primarySupport) >= SUPPORT_LEVELS.indexOf(stop.primary_support_level);
}

export function stepXp(i: StepXpInput): StepXpAward[] {
  if (stepXpStopped(i.primarySupport, i.primaryMastered)) return [];
  const r = game.xp.step_rewards;
  const out: StepXpAward[] = [];
  if (i.planned && r.step_planned > 0) out.push({ reason: "step_planned", amount: r.step_planned, source_id: i.missionId });
  if (i.predicted && r.step_prediction > 0) out.push({ reason: "step_prediction", amount: r.step_prediction, source_id: i.missionId });
  if (i.resumed && r.step_resumed > 0) out.push({ reason: "step_resumed", amount: r.step_resumed, source_id: i.missionId });
  const n = Math.min(i.distractionsHandled, r.step_distraction_handled.max_per_mission);
  for (let k = 1; k <= n; k++) if (r.step_distraction_handled.per_event > 0) out.push({ reason: "step_distraction_handled", amount: r.step_distraction_handled.per_event, source_id: `${i.missionId}:${k}` });
  return out;
}
