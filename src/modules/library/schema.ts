/**
 * مخطط قالب المهمة (4.4) كما يُكتب في content/templates/*.json ويُخزَّن في mission_templates.
 */
import { z } from "zod";
import { AGE_MODES, CAPABILITY_IDS, MECHANIC_IDS, TRAINING_LEVELS, SUPPORT_LEVELS, type AgeMode } from "@/shared/config";

const byModeText = z.union([z.string().min(1), z.object({ child: z.string().optional(), teen: z.string().optional(), adult: z.string().optional() })]);
export type ByModeText = z.infer<typeof byModeText>;

export const evidenceValueSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice_map"), field: z.literal("distraction_log"), aggregate: z.literal("mean"), map: z.object({ ignore: z.number(), break_return: z.number(), give_in: z.number() }) }),
  z.object({ kind: z.literal("strategy_fit") }),
  z.object({ kind: z.literal("prediction_error"), tolerance: z.number().positive() }),
  z.object({ kind: z.literal("hint_count"), map: z.object({ "0": z.number(), "1": z.number(), "2+": z.number() }) }),
  z.object({ kind: z.literal("recovery") }),
  z.object({ kind: z.literal("ai_candidate") }),
  z.object({ kind: z.literal("mirror") }),
]);

export const evidenceRuleSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["strategy_fit", "prediction_accuracy", "recovery", "distraction_response", "help_needed", "reflection_quality", "transfer_report", "guardian_observation", "companion_insight", "novel_context"]),
  capability_id: z.enum(CAPABILITY_IDS),
  source: z.enum(["auto", "ai", "self", "guardian"]),
  rule_weight: z.number().min(0).max(1).optional(),
  value: evidenceValueSpecSchema,
});

export const strategySchema = z.object({
  id: z.string().min(1),
  text: byModeText,
  fit: z.number().min(-1).max(1),
  outcome_hint: z.string().optional(),
});

export const templateSchema = z.object({
  id: z.string().regex(/^[a-z]{2}-(sim|real)-\d{2}$/),
  version: z.number().int().positive(),
  mechanic: z.enum(MECHANIC_IDS),
  training_level: z.enum(TRAINING_LEVELS),
  difficulty: z.number().int().min(1).max(5),
  age_modes: z.array(z.enum(AGE_MODES)).min(1),
  capability_weights: z.partialRecord(z.enum(CAPABILITY_IDS), z.number().positive().max(1)),
  title: byModeText,
  situation: byModeText,
  variable_defaults: z.object({ time_budget: z.number().int().positive().optional(), context: byModeText.optional() }).default({}),
  strategies: z.array(strategySchema).min(2).max(4),
  prediction_prompt: byModeText.nullable().optional(),
  reflection_prompts: z.array(byModeText).min(1),
  hints_by_level: z.partialRecord(z.enum(SUPPORT_LEVELS), z.array(z.string())).default({}),
  evidence_rules: z.array(evidenceRuleSchema),
  completion_check: z.enum(["self_report", "timer", "checklist", "guardian_confirm", "photo"]),
  checklist: z.array(z.string().min(1)).nullable().optional(),
  min_duration: z.number().int().positive(),
  max_duration: z.number().int().positive(),
  distraction_config: z.object({ count: z.number().int().positive(), kind: z.string().min(1) }).nullable().optional(),
  status: z.enum(["draft", "active", "retired"]).default("active"),
  origin: z.enum(["human", "ai_draft"]).default("human"),
  /** 0.5 أ.5: none تمرين محايد، optional، required موقف يحتاج حياة المستخدم (يركّبه الخادم) */
  life_binding: z.enum(["none", "optional", "required"]).default("none"),
}).superRefine((t, ctx) => {
  if (t.max_duration < t.min_duration) ctx.addIssue({ code: "custom", message: "max_duration < min_duration" });
  const sum = Object.values(t.capability_weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001) ctx.addIssue({ code: "custom", message: `capability_weights must sum to 1 (got ${sum})` });
  if (t.completion_check === "checklist" && !(t.checklist && t.checklist.length)) ctx.addIssue({ code: "custom", message: "checklist required" });
  if (t.mechanic === "resist_distraction" && t.training_level === "simulated" && !t.distraction_config) ctx.addIssue({ code: "custom", message: "distraction_config required for simulated resist_distraction" });
  for (const r of t.evidence_rules) {
    if (r.value.kind === "prediction_error" && !t.prediction_prompt) ctx.addIssue({ code: "custom", message: `rule ${r.id}: prediction_error needs prediction_prompt` });
    if (r.value.kind === "choice_map" && !t.distraction_config && r.source === "auto") ctx.addIssue({ code: "custom", message: `rule ${r.id}: auto choice_map needs distraction_config` });
  }
  const ids = new Set(t.strategies.map((s) => s.id));
  if (ids.size !== t.strategies.length) ctx.addIssue({ code: "custom", message: "duplicate strategy ids" });
});

export type MissionTemplate = z.infer<typeof templateSchema>;

/** نص بحسب الوضع العمري مع سقوط مرتّب. */
export function textByMode(value: ByModeText | null | undefined, mode: AgeMode): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[mode] ?? value.adult ?? value.teen ?? value.child ?? "";
}

/** القدرة الأساسية للقالب = الأعلى وزنًا (الملحق أ.6). */
export function primaryCapability(t: Pick<MissionTemplate, "capability_weights">): string {
  return Object.entries(t.capability_weights).sort((a, b) => b[1] - a[1])[0]![0];
}

/** ملء المتغيرات {{context}} و{{time_budget}} في نص الموقف. */
export function fillVariables(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`));
}
