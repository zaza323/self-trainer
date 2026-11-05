/**
 * الإنجازات التربوية (أ.9) — قواعد نقية. كل الأرقام من config/game.json.achievements.
 */
import { game } from "@/shared/config";

export type AchievementCode = "comeback" | "mindful_abandon" | "new_context" | "play_less";

/** "عدتَ بعد انقطاع": أول مهمة reflected خلال N ساعة من العودة بعد انقطاع ≥ M أيام. */
export function isComeback(args: { previousActivityAt: Date | null; resumedAt: Date; reflectedAt: Date }): boolean {
  if (!args.previousActivityAt) return false;
  const gapDays = (args.resumedAt.getTime() - args.previousActivityAt.getTime()) / 86400000;
  const withinHours = (args.reflectedAt.getTime() - args.resumedAt.getTime()) / 3600000;
  return gapDays >= game.comeback.min_gap_days && withinHours <= game.comeback.reflect_within_hours;
}

/** مستوى إنجاز العودة بحسب عدد المرات (1، 3، 10). يعيد المستوى الذي تحقق الآن أو null. */
export function comebackTierReached(count: number): number | null {
  const tiers = game.achievements.comeback.tiers;
  const idx = tiers.indexOf(count);
  return idx === -1 ? null : idx + 1;
}

/** "تخليتَ بوعي": مهمة abandoned أكملت تأملها وفيها دليل reflection_quality على self_awareness ≥ الحد. */
export function isMindfulAbandon(args: { gate1: boolean; reflected: boolean; evidence: Array<{ capability_id: string; type: string; value: number }> }): boolean {
  const r = game.achievements.mindful_abandon;
  return !args.gate1 && args.reflected && args.evidence.some((e) => e.capability_id === r.capability && e.type === "reflection_quality" && e.value >= r.min_reflection_value);
}

/** "طبقتَ في سياق جديد": أول دليل novel_context ≥ الحد، مرة لكل قدرة. */
export function newContextCapabilities(evidence: Array<{ capability_id: string; type: string; value: number }>): string[] {
  const r = game.achievements.new_context;
  return [...new Set(evidence.filter((e) => e.type === "novel_context" && e.value >= r.min_value).map((e) => e.capability_id))];
}

export type PlayLessInput = {
  stage: number;
  activeDaysLast28: number;
  activeDaysPrev28: number;
  workedTransferReportsLast28: number;
  /** لكل قدرة نشطة: الدرجة في بداية النافذة ونهايتها */
  capabilityDeltas: Array<{ start: number; end: number; active: boolean }>;
  masteryChecksInWindow: Array<{ passed: boolean }>;
};

/**
 * "تلعب أقل" (أ.9): كل الشروط معًا. الشرط (3) هو ما يفرّق بين "صار مستقلًا" و"ترك التطبيق":
 * من ترك لا يبلّغ عن نقل.
 */
export function qualifiesPlayLess(i: PlayLessInput): { ok: boolean; failed: string[] } {
  const r = game.achievements.play_less;
  const failed: string[] = [];
  if (i.stage < r.min_stage) failed.push("stage");
  const dropRatio = i.activeDaysPrev28 > 0 ? (i.activeDaysPrev28 - i.activeDaysLast28) / i.activeDaysPrev28 : 0;
  if (!(dropRatio >= r.min_active_days_drop_ratio)) failed.push("active_days_drop");
  if (i.workedTransferReportsLast28 < r.min_worked_transfer_reports) failed.push("transfer_reports");
  if (i.capabilityDeltas.some((c) => c.active && c.start - c.end > r.max_capability_drop_points)) failed.push("capability_drop");
  if (r.require_all_mastery_checks_passed && i.masteryChecksInWindow.some((m) => !m.passed)) failed.push("mastery_checks");
  return { ok: failed.length === 0, failed };
}
