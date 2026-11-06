/**
 * مستويات الأدوات (0.4 ب.2) — دوال نقية. الانفتاح مع الاستقلالية: avg_support أو مرحلة الحوافز، بداية حسب الوضع، تجاوز يدوي،
 * ولا إغلاق بعد الانفتاح (never_lock_after_unlock). كل القيم من config/planner.json.tiers.
 */
import { planner, type AgeMode, type PlannerTool } from "@/shared/config";

export type PlannerTier = 0 | 1 | 2;

export type TierInput = {
  ageMode: AgeMode;
  avgSupport: number;          // متوسط مؤشر الدعم على القدرات النشطة (game.avgSupport)
  incentiveStage: number;      // 1..4
  override: number | null;     // planner_tier_override الفعّال (null = لا تجاوز)
  maxUnlocked: number;         // profiles.planner_tier_max
};

/** المستوى المحسوب من الاستقلالية فقط (بلا تجاوز ولا ذاكرة). */
export function earnedTier(i: Pick<TierInput, "ageMode" | "avgSupport" | "incentiveStage">): PlannerTier {
  const t = planner.tiers;
  let tier: PlannerTier = t.start_by_age_mode[i.ageMode] as PlannerTier;
  const u1 = t.unlock["1"], u2 = t.unlock["2"];
  if (i.avgSupport >= u1.min_avg_support || i.incentiveStage >= u1.or_min_incentive_stage) tier = Math.max(tier, 1) as PlannerTier;
  if (i.avgSupport >= u2.min_avg_support || i.incentiveStage >= u2.or_min_incentive_stage) tier = Math.max(tier, 2) as PlannerTier;
  return tier;
}

export type TierResult = { tier: PlannerTier; earned: PlannerTier; justUnlocked: boolean; newMax: PlannerTier };

/** المستوى الفعّال: التجاوز اليدوي إن وُجد، وإلا الأعلى بين المكتسب والمحفوظ (لا إغلاق بعد الانفتاح). */
export function plannerTier(i: TierInput): TierResult {
  const earned = earnedTier(i);
  const remembered = planner.tiers.never_lock_after_unlock ? Math.max(earned, Math.min(2, Math.max(0, i.maxUnlocked))) : earned;
  const newMax = remembered as PlannerTier;
  const justUnlocked = earned > i.maxUnlocked;
  const tier = (i.override !== null && Number.isInteger(i.override) ? Math.min(2, Math.max(0, i.override)) : remembered) as PlannerTier;
  return { tier, earned, justUnlocked, newMax };
}

export function toolsForTier(tier: PlannerTier): Set<PlannerTool> {
  const t = planner.tiers.tools;
  const out = new Set<PlannerTool>(t["0"]);
  if (tier >= 1) for (const x of t["1"]) out.add(x);
  if (tier >= 2) for (const x of t["2"]) out.add(x);
  return out;
}

export function hasTool(tier: PlannerTier, tool: PlannerTool): boolean {
  return toolsForTier(tier).has(tool);
}
