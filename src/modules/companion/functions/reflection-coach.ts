import type { SupabaseClient } from "@supabase/supabase-js";
import { ai, scoring, type AgeMode, type SupportLevel } from "@/shared/config";
import type { MissionTemplate } from "@/modules/library";
import { textByMode } from "@/modules/library";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, supportStyle, FUNCTION_INSTRUCTIONS } from "../prompts";
import { reflectionCoachOutput, questionMarks, type ReflectionCoachOutput } from "../schemas";

export type ReflectionTurnInput = {
  db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode; support: SupportLevel;
  template: MissionTemplate;
  missionFacts: Record<string, unknown>;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  turn: number;             // عدد أدوار المستخدم حتى الآن (شامل هذه)
  customStrategy: string | null;
  /** 4.13.2: عند L2–L3 يستحضر المرافق ذاكرة الاستراتيجيات في التأمل فقط */
  strategyRecall?: string | null;
  fixedPrompts: string[];   // أسئلة السقوط
};

export function verifyReflectionOutput(out: ReflectionCoachOutput, template: MissionTemplate, customStrategy: string | null, turn: number): string | null {
  if (out.next_question && questionMarks(out.next_question) > ai.validation.max_questions_per_reply) return "more_than_one_question";
  if (!out.done && !out.next_question) return "question_required";
  if (out.done && out.next_question) return "no_question_when_done";
  if (!customStrategy && out.custom_strategy_fit !== null) return "fit_without_custom_strategy";
  const allowed = new Set([...Object.keys(template.capability_weights), ...scoring.global_rules.G4_reflection_quality.extra_allowed_capabilities]);
  for (const c of out.evidence_candidates) if (!allowed.has(c.capability_id)) return `candidate_capability_not_allowed:${c.capability_id}`;
  if (turn >= ai.validation.reflection_max_turns && !out.done) return "must_be_done_at_max_turns";
  return null;
}

/** السقوط: أسئلة القالب الثابتة بلا أدلة ai. */
export function fixedReflectionTurn(prompts: string[], turn: number, userMessage: string): ReflectionCoachOutput {
  const done = turn >= prompts.length || turn >= ai.validation.reflection_max_turns;
  return { next_question: done ? null : prompts[turn]!, done, reflection_summary_user_words: done ? userMessage : null, thinking_move_named: null, custom_strategy_fit: null, evidence_candidates: [], safety: { flag: false, category: null, severity: null } };
}

export async function reflectionCoachTurn(i: ReflectionTurnInput): Promise<{ output: ReflectionCoachOutput; source: "ai" | "fixed" }> {
  const dynamic = [
    supportStyle(i.support),
    `الدور ${i.turn} من ${ai.validation.reflection_max_turns}. ${i.turn >= ai.validation.reflection_max_turns ? "هذا الدور الأخير: done=true إلزاميًا." : ""}`,
    `قدرات القالب: ${Object.keys(i.template.capability_weights).join(", ")}. الموقف: ${textByMode(i.template.situation, i.mode)}`,
    `أسئلة القالب: ${i.template.reflection_prompts.map((q) => textByMode(q, i.mode)).join(" | ")}`,
    `وقائع المهمة: ${JSON.stringify(i.missionFacts)}`,
    i.customStrategy ? `الاستراتيجية المخصصة التي كتبها المستخدم: «${i.customStrategy}»` : "لا استراتيجية مخصصة (custom_strategy_fit=null).",
    i.strategyRecall ? `ذاكرة الاستراتيجيات (استحضرها في سؤالك إن ناسب): ${i.strategyRecall}` : "",
  ].filter(Boolean).join("\n");
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "reflection_coach", profileId: i.profileId,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.reflection_coach}`, dynamicSystem: dynamic,
    messages: [...i.history, { role: "user", content: i.userMessage }], schema: reflectionCoachOutput,
    verify: (o) => verifyReflectionOutput(o, i.template, i.customStrategy, i.turn),
  });
  if (r.ok) {
    const data = { ...r.data, evidence_candidates: r.data.evidence_candidates.map((c) => ({ ...c, value: Math.max(-1, Math.min(1, c.value)) })) };
    return { output: data, source: "ai" };
  }
  return { output: fixedReflectionTurn(i.fixedPrompts, i.turn, i.userMessage), source: "fixed" };
}
