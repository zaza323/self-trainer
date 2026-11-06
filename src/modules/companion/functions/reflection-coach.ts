import type { SupabaseClient } from "@supabase/supabase-js";
import { ai, scoring, type AgeMode, type Moment, type SupportLevel } from "@/shared/config";
import type { MissionTemplate } from "@/modules/library";
import { textByMode } from "@/modules/library";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, supportStyle, FUNCTION_INSTRUCTIONS } from "../prompts";
import { reflectionCoachOutput, questionMarks, type ReflectionCoachOutput, type Shaped } from "../schemas";
import { enforceShape, isStuckText, isStuckHesitation, needsSoftFollowUp, type Shape, type RawOption } from "../response-mode";
import messagesContent from "@content/companion_messages.ar.json";

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
  /** 0.4 أ: السياق الذي يحتاجه فرض الشكل */
  session?: { used: number; budget: number };
  /** طريقة إدخال آخر إجابة: خيار لا يولّد دليل reflection_quality (أ.6) */
  inputMethod?: "typed" | "voice" | "option";
  /** لحظة السؤال الذي أجاب عنه المستخدم (للحد الأدنى اللطيف) وهل سُئل سؤال المتابعة سابقًا */
  answeredMoment?: Moment;
  followUpAsked?: boolean;
  hesitationSeconds?: number;
  /** خيارات من كلمات المستخدم (تسميات strategy_outcomes) وخيارات القالب */
  userWords?: string[];
  templateOptions?: string[];
};

const REFLECTION_MOMENTS: Moment[] = ["reflection_secondary", "obstacle_naming", "feeling_check"];

/** لحظة السؤال القادم: الأول reflection_core ثم reflection_secondary (أو obstacle_naming إن اقترحه النموذج). */
export function reflectionMoment(turn: number, proposed?: Moment): Moment {
  if (turn === 0) return "reflection_core";
  return proposed && REFLECTION_MOMENTS.includes(proposed) ? proposed : "reflection_secondary";
}

export function shapeReflectionOutput(i: ReflectionTurnInput, out: ReflectionCoachOutput): { output: Shaped<ReflectionCoachOutput>; shape: Shape } {
  const moment = reflectionMoment(i.turn, out.moment);
  const afterStuck = i.turn > 0 && (isStuckText(i.userMessage) || (i.hesitationSeconds !== undefined && isStuckHesitation(i.hesitationSeconds)));
  const shape = enforceShape({
    moment, support: i.support, ageMode: i.mode, afterStuck,
    session: i.session ?? { used: 0, budget: ai.response_modes.free_text_budget.per_session },
    model: { response_mode: out.response_mode, options: out.options as RawOption[] | undefined },
    userWords: i.userWords, template: i.templateOptions,
  });
  const final = out.done ? { ...shape, response_mode: "free_text" as const, options: [], consumesBudget: false } : shape;
  // أ.6: مرشحات reflection_quality تُقبل فقط من إجابات free_text (مكتوبة أو صوتية)؛ إجابة بخيار لا تولّد دليلًا ولا تُحتسب سلبًا
  const candidates = i.inputMethod === "option" ? [] : out.evidence_candidates;
  return { output: { ...out, evidence_candidates: candidates, moment: final.moment, response_mode: final.response_mode, options: final.options }, shape: final };
}

/** أ.4: إجابة أقصر من الحد اللطيف في reflection_core/obstacle_naming ⇒ سؤال متابعة واحد فقط من المحتوى ثم القبول. */
export function softFollowUpTurn(i: ReflectionTurnInput): { output: Shaped<ReflectionCoachOutput>; source: "fixed"; shape: Shape; softFollowUp: true } | null {
  if (!i.answeredMoment) return null;
  if (!needsSoftFollowUp({ moment: i.answeredMoment, ageMode: i.mode, text: i.userMessage, alreadyAsked: Boolean(i.followUpAsked), inputMethod: i.inputMethod })) return null;
  const shape: Shape = { moment: i.answeredMoment, response_mode: "free_text", options: [], consumesBudget: false, replaced: null };
  const output: Shaped<ReflectionCoachOutput> = {
    next_question: messagesContent.soft_min_followup, done: false, reflection_summary_user_words: null, thinking_move_named: null, custom_strategy_fit: null,
    evidence_candidates: [], safety: { flag: false, category: null, severity: null },
    moment: shape.moment, response_mode: "free_text", options: [],
  };
  return { output, source: "fixed", shape, softFollowUp: true };
}

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

export async function reflectionCoachTurn(i: ReflectionTurnInput): Promise<{ output: Shaped<ReflectionCoachOutput>; source: "ai" | "fixed"; shape: Shape; softFollowUp?: boolean }> {
  const soft = softFollowUpTurn(i);
  if (soft) return soft;
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
    meta: (o) => shapeReflectionOutput(i, o).shape.replaced,
  });
  if (r.ok) {
    const data = { ...r.data, evidence_candidates: r.data.evidence_candidates.map((c) => ({ ...c, value: Math.max(-1, Math.min(1, c.value)) })) };
    return { ...shapeReflectionOutput(i, data), source: "ai" };
  }
  return { ...shapeReflectionOutput(i, fixedReflectionTurn(i.fixedPrompts, i.turn, i.userMessage)), source: "fixed" };
}
