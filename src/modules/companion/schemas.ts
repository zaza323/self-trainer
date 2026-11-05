/**
 * مخططات مخرجات وظائف الذكاء الاصطناعي (7.2، الملحق أ.1) — تُتحقق بـ Zod قبل أي حفظ.
 */
import { z } from "zod";
import { CAPABILITY_IDS, MECHANIC_IDS } from "@/shared/config";

export const thinkingMoveSchema = z.enum(["decompose", "clarify_motive", "concretize", "prioritize", "estimate_time", "anticipate_obstacle", "reframe"]);
export const safetySchema = z.object({
  flag: z.boolean(),
  category: z.enum(["self_harm", "abuse", "immediate_danger", "age_inappropriate"]).nullable(),
  severity: z.enum(["low", "medium", "high"]).nullable(),
});
export type Safety = z.infer<typeof safetySchema>;

export const goalBuilderOutput = z.object({
  next_question: z.string().nullable(),
  reflection_of_user_words: z.string(),
  thinking_move_named: thinkingMoveSchema.nullable(),
  phase: z.enum(["explore", "climb_why", "descend_how", "confirm", "done"]),
  draft: z.object({
    goals: z.array(z.object({ temp_id: z.string(), parent_temp_id: z.string().nullable(), title_user_words: z.string(), why_user_words: z.string().nullable() })),
    first_step_user_words: z.string().nullable(),
  }),
  needs_user_confirmation: z.boolean(),
  safety: safetySchema,
});
export type GoalBuilderOutput = z.infer<typeof goalBuilderOutput>;

export const reflectionCoachOutput = z.object({
  next_question: z.string().nullable(),
  done: z.boolean(),
  reflection_summary_user_words: z.string().nullable(),
  thinking_move_named: thinkingMoveSchema.nullable(),
  custom_strategy_fit: z.number().min(-1).max(1).nullable(),
  evidence_candidates: z.array(z.object({ capability_id: z.enum(CAPABILITY_IDS), type: z.literal("reflection_quality"), value: z.number().min(-1).max(1), rationale: z.string() })).max(3),
  safety: safetySchema,
});
export type ReflectionCoachOutput = z.infer<typeof reflectionCoachOutput>;

export const missionSelectorOutput = z.object({
  template_id: z.string(),
  variables: z.object({ context: z.string().max(120).optional(), time_budget: z.number().int().positive().optional() }),
  difficulty: z.number().int().min(1).max(5),
  rationale: z.string().max(300),
});
export type MissionSelectorOutput = z.infer<typeof missionSelectorOutput>;

export const taskClassifierOutput = z.object({
  mechanic: z.enum(MECHANIC_IDS),
  capability_weights: z.partialRecord(z.enum(CAPABILITY_IDS), z.number().min(0).max(1)),
  suggested_goal_id: z.string().nullable(),
  reflection_prompts: z.array(z.string().min(1)).min(1).max(4),
});
export type TaskClassifierOutput = z.infer<typeof taskClassifierOutput>;

export const progressNarratorOutput = z.object({
  narrative: z.string().min(1).max(1200),
  highlighted_capability: z.enum(CAPABILITY_IDS).nullable(),
});
export type ProgressNarratorOutput = z.infer<typeof progressNarratorOutput>;

/** companion_chat: الرد يُبث نصًا؛ هذا مخطط التحليل المهيكل اللاحق للرد (مؤشرات، طلب إنسان، أمان، اقتراح سياق). */
export const companionChatAnalysis = z.object({
  insights: z.array(z.object({ capability_id: z.enum(CAPABILITY_IDS), type: z.string().min(1).max(40), value: z.number().min(-1).max(1), confidence: z.number().min(0).max(1) })).max(3),
  needs_human: z.object({ flag: z.boolean(), reason: z.string().nullable() }),
  safety: safetySchema,
  context_suggestion: z.object({ field: z.enum(["interests", "routine", "free_windows", "contexts"]), value: z.string().min(1).max(120) }).nullable(),
});
export type CompanionChatAnalysis = z.infer<typeof companionChatAnalysis>;

export const weeklySummaryOutput = z.object({
  improved: z.array(z.string().max(200)).max(5),
  needs_support: z.array(z.string().max(200)).max(5),
  guardian_tip: z.string().max(400),
});
export type WeeklySummaryOutput = z.infer<typeof weeklySummaryOutput>;

export const strategyNormalizerOutput = z.object({ label: z.string().min(1).max(40) });

/** adaptation_advisor (7.2، 7.6): حتى اقتراحين من الأنواع المسموحة */
export const adaptationAdvisorOutput = z.object({
  suggestions: z.array(z.object({
    type: z.string().min(1).max(40),
    setting_key: z.string().max(60).nullable(),
    proposed_value: z.unknown(),
    reason_short: z.string().max(200),
    expected_effect: z.string().max(200),
  })).max(5),
});
export type AdaptationAdvisorOutput = z.infer<typeof adaptationAdvisorOutput>;

/** مصنّف الأمان بالنموذج (7.4) */
export const safetyClassifierOutput = safetySchema;

/** عدد علامات الاستفهام في نص (قاعدة سؤال واحد) */
export function questionMarks(text: string): number {
  return (text.match(/[?؟]/g) ?? []).length;
}
