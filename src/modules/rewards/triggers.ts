/**
 * محفزات المكافآت الواقعية والإنجازات الخاصة (4.12.2) — دوال نقية.
 * المسموح: مَعلَم مهارة أو نقل. الممنوع (عدد المهام، XP، streak، وقت التطبيق) يُرفض مع السبب.
 * المرآة الفعلية في قاعدة البيانات: app.validate_reward_trigger.
 */
import { habitConsistency, type HabitSchedule, type Checkin } from "@/modules/planner/habits";
import type { WeekStart } from "@/modules/planner/recurrence";
import { customization, CAPABILITY_IDS, type CapabilityId, type TrainingLevel } from "@/shared/config";

export type TriggerType = "gate2_shown_count" | "training_level_reached" | "transfer_reports" | "achievement_earned" | "goal_completed" | "surprise" | "habit_consistency";
export type TriggerParams = Record<string, unknown>;

const LEVEL_ORDER = ["simulated", "guided_real", "independent_real", "transfer", "mastered"] as const;

export type TriggerValidation = { ok: true; type: TriggerType; params: TriggerParams } | { ok: false; reason: "forbidden" | "unknown" | "invalid_params" | "surprise_not_allowed"; explanation: string };

export function validateTrigger(type: string, params: TriggerParams, opts: { allowSurprise: boolean; achievementCodes?: string[]; goalIds?: string[]; habitIds?: string[] }): TriggerValidation {
  const cfg = customization.real_rewards;
  if (cfg.forbidden_triggers.includes(type)) return { ok: false, reason: "forbidden", explanation: "يكافئ النشاط أو العملة أو السلسلة أو وقت الاستخدام لا التعلم (4.12.2)" };
  const spec = cfg.allowed_triggers[type]?.params as Record<string, unknown> | undefined;
  if (!spec) return { ok: false, reason: "unknown", explanation: "محفز غير معروف" };
  if (type === "surprise" && !opts.allowSurprise) return { ok: false, reason: "surprise_not_allowed", explanation: "المفاجأة للمكافآت فقط" };
  const bad = (what: string): TriggerValidation => ({ ok: false, reason: "invalid_params", explanation: `معامل غير صالح: ${what}` });
  if ("capability_id" in spec && !(CAPABILITY_IDS as readonly string[]).includes(String(params.capability_id))) return bad("capability_id");
  if ("count" in spec) { const r = spec.count as { min: number; max: number }; const n = Number(params.count); if (!Number.isInteger(n) || n < r.min || n > r.max) return bad("count"); }
  if ("min_distinct_contexts" in spec) { const r = spec.min_distinct_contexts as { min: number; max: number }; const n = params.min_distinct_contexts === undefined ? r.min : Number(params.min_distinct_contexts); if (!Number.isInteger(n) || n < r.min || n > r.max) return bad("min_distinct_contexts"); params = { ...params, min_distinct_contexts: n }; }
  if ("level" in spec && !(spec.level as string[]).includes(String(params.level))) return bad("level");
  if ("achievement_code" in spec && opts.achievementCodes && !opts.achievementCodes.includes(String(params.achievement_code))) return bad("achievement_code");
  if ("goal_id" in spec && (!params.goal_id || (opts.goalIds && !opts.goalIds.includes(String(params.goal_id))))) return bad("goal_id");
  // 0.4 ب.8: habit_consistency — نسبة التزام ≥ X لمدة N أسابيع (ليست سلسلة أيام متتالية)
  if ("habit_id" in spec && (!params.habit_id || (opts.habitIds && !opts.habitIds.includes(String(params.habit_id))))) return bad("habit_id");
  if ("min_weekly_rate" in spec) { const r = spec.min_weekly_rate as { min: number; max: number }; const n = Number(params.min_weekly_rate); if (!Number.isFinite(n) || n < r.min || n > r.max) return bad("min_weekly_rate"); }
  if ("weeks" in spec) { const r = spec.weeks as { min: number; max: number }; const n = Number(params.weeks); if (!Number.isInteger(n) || n < r.min || n > r.max) return bad("weeks"); }
  return { ok: true, type: type as TriggerType, params };
}

/** الوقائع المتاحة للتقييم — كلها منذ لحظة التفعيل (لا أثر رجعي، 4.12.3/القسم 13). */
export type TriggerFacts = {
  shownByCapability: Record<string, number>;
  trainingLevelByCapability: Record<string, TrainingLevel | "mastered">;
  transferReports: Array<{ worked: boolean; context_tag: string }>;
  achievementCodes: string[];
  completedGoalIds: string[];
  /** 0.4: العادات مع تسجيلاتها، وسياق الأسبوع (اليوم وبدايته) لحساب habit_consistency */
  habits?: Array<{ id: string; schedule: HabitSchedule; checkins: Checkin[] }>;
  habitContext?: { today: string; weekStart: WeekStart };
};

export function triggerSatisfied(type: TriggerType, params: TriggerParams, facts: TriggerFacts): boolean {
  switch (type) {
    case "gate2_shown_count": return (facts.shownByCapability[String(params.capability_id)] ?? 0) >= Number(params.count);
    case "training_level_reached": {
      const cur = facts.trainingLevelByCapability[String(params.capability_id)];
      if (!cur) return false;
      return LEVEL_ORDER.indexOf(cur) >= LEVEL_ORDER.indexOf(String(params.level) as (typeof LEVEL_ORDER)[number]);
    }
    case "transfer_reports": {
      const worked = facts.transferReports.filter((r) => r.worked);
      return worked.length >= Number(params.count) && new Set(worked.map((r) => r.context_tag)).size >= Number(params.min_distinct_contexts ?? 1);
    }
    case "achievement_earned": return facts.achievementCodes.includes(String(params.achievement_code));
    case "goal_completed": return facts.completedGoalIds.includes(String(params.goal_id));
    case "surprise": return true;
    case "habit_consistency": {
      const h = facts.habits?.find((x) => x.id === String(params.habit_id));
      if (!h || !facts.habitContext) return false;
      return habitConsistency(h.schedule, h.checkins, facts.habitContext.today, facts.habitContext.weekStart, Number(params.min_weekly_rate), Number(params.weeks));
    }
  }
}

export const isCapabilityId = (s: string): s is CapabilityId => (CAPABILITY_IDS as readonly string[]).includes(s);
