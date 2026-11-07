/**
 * الجسر بين المخطط والتدريب (0.4 ب.11) — قواعد نقية لأدلة P1–P5. كل القيم من config/planner.json.evidence_bridge.
 * المهام المعاد جدولتها تلقائيًا (ب.10) لا تولّد أي دليل.
 */
import { planner, scoring, type MechanicId, type SupportLevel } from "@/shared/config";
import { predictionValue } from "@/modules/evidence/rules";

type Rule = { type: string; capability: string; source: string; value: unknown; min_postpones?: number; min_support_level?: SupportLevel; requires_cancel_reason?: boolean };
const bridge = planner.evidence_bridge as unknown as {
  rule_weight: number; daily_cap_per_capability: number; rules: Record<"P1" | "P2" | "P3" | "P4" | "P5", Rule>;
  convert_to_mission: { levels: Array<"guided_real" | "independent_real">; completing_mission_completes_task: boolean; default_mechanic: MechanicId; default_minutes: number; independent_from_training_levels: string[] };
};
export const bridgeConfig = bridge;
const LEVELS: SupportLevel[] = ["L0_instruct", "L1_hint", "L2_ask", "L3_free"];
export const supportIndex = (l: SupportLevel) => LEVELS.indexOf(l);

export type BridgeTask = { estimate_min: number | null; actual_min: number | null; postpone_count: number; auto_rescheduled: boolean; status: string; cancel_reason?: string | null };

/** P1: مهمة منجزة لها تقدير ومدة فعلية ⇒ prediction_error (tolerance من القاعدة). */
export function p1Value(t: BridgeTask): number | null {
  if (t.auto_rescheduled || t.status !== "done" || !t.estimate_min || t.actual_min === null || t.actual_min === undefined) return null;
  const v = bridge.rules.P1.value as { tolerance: number };
  return predictionValue(t.actual_min, t.estimate_min, v.tolerance ?? scoring.value_defaults.prediction_tolerance);
}

/** P2: «تشتّت» في التركيز: رجع وأكمل +0.6، أنهى الجلسة −0.2، بلا جواب لا دليل. */
export function p2Value(returned: boolean | null): number | null {
  if (returned === null) return null;
  const v = bridge.rules.P2.value as { returned: number; ended_session: number };
  return returned ? v.returned : v.ended_session;
}

/** P3: أُجّلت ≥ min_postpones ثم أُنجزت (والتأجيل ليس تلقائيًا). */
export function p3Value(t: BridgeTask): number | null {
  if (t.auto_rescheduled || t.status !== "done") return null;
  return t.postpone_count >= (bridge.rules.P3.min_postpones ?? 2) ? (bridge.rules.P3.value as number) : null;
}

/** P4: عند L2+ كتب تقسيمه بنفسه دون task_breakdown. لا قيمة سلبية لاستخدام المساعدة. */
export function p4Value(i: { planningLevel: SupportLevel; userSteps: number; usedAi: boolean; autoRescheduled: boolean }): number | null {
  if (i.autoRescheduled || i.usedAi || i.userSteps < 1) return null;
  if (supportIndex(i.planningLevel) < supportIndex(bridge.rules.P4.min_support_level ?? "L2_ask")) return null;
  return bridge.rules.P4.value as number;
}

/** P5: إلغاء واعٍ مع سبب مكتوب. */
export function p5Value(t: BridgeTask): number | null {
  if (t.auto_rescheduled || t.status !== "cancelled") return null;
  if (bridge.rules.P5.requires_cancel_reason && !(t.cancel_reason ?? "").trim()) return null;
  return bridge.rules.P5.value as number;
}

/** مستوى مهمة التدريب المحوَّلة حسب مستوى تدريب القدرة (ب.11). */
export function convertedTrainingLevel(capabilityTrainingLevel: string | null): "guided_real" | "independent_real" {
  return capabilityTrainingLevel && bridge.convert_to_mission.independent_from_training_levels.includes(capabilityTrainingLevel) ? "independent_real" : "guided_real";
}

/** المتأخر للبالغ فقط عند تفعيل الإعداد (ب.10). */
export function overdueToReschedule<T extends { status: string; due_date: string | null; parent_task_id?: string | null }>(tasks: T[], today: string): T[] {
  return tasks.filter((t) => t.status === "open" && t.due_date !== null && t.due_date < today);
}
export const autoRescheduleAgeModes = (planner.ai as unknown as { overdue: { auto_reschedule_age_modes: string[] } }).overdue.auto_reschedule_age_modes;
