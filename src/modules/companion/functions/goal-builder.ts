import type { SupabaseClient } from "@supabase/supabase-js";
import { ai, limits, type AgeMode, type Moment, type SupportLevel } from "@/shared/config";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "../prompts";
import { goalBuilderOutput, questionMarks, type GoalBuilderOutput, type Shaped } from "../schemas";
import { enforceShape, isStuckText, isStuckHesitation, type Shape, type RawOption } from "../response-mode";
import fixedQuestions from "@content/fixed_questions.ar.json";

export type GoalTurnInput = {
  db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  draft: GoalBuilderOutput["draft"] | null;
  turn: number;
  /** 0.4 أ: مستوى دعم قدرة اللحظة (الوعي بالدوافع) وميزانية الكتابة الحالية للجلسة */
  support?: SupportLevel;
  session?: { used: number; budget: number };
  /** تردد المستخدم قبل الرد بالثواني (لـ stuck) */
  hesitationSeconds?: number;
};

/** لحظة السؤال القادم من مرحلة الحوار (أ.2). */
export function goalMoment(phase: GoalBuilderOutput["phase"]): Moment {
  return phase === "climb_why" ? "goal_why" : phase === "confirm" || phase === "done" ? "confirm" : "goal_what";
}

const SHORT = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
function userWordsOf(i: GoalTurnInput, out: GoalBuilderOutput): string[] {
  const fromDraft = out.draft.goals.flatMap((g) => [g.title_user_words, g.why_user_words ?? ""]);
  const fromHistory = i.history.filter((m) => m.role === "user").map((m) => m.content);
  return SHORT([...fromDraft, ...fromHistory, i.userMessage]);
}

/** يفرض شكل الرد من السياسة على مخرج صالح (أ.3). goal_why لا يحمل خيارات أبدًا. */
export function shapeGoalOutput(i: GoalTurnInput, out: GoalBuilderOutput): { output: Shaped<GoalBuilderOutput>; shape: Shape } {
  const moment = goalMoment(out.phase);
  const afterStuck = isStuckText(i.userMessage) || (i.hesitationSeconds !== undefined && isStuckHesitation(i.hesitationSeconds));
  const shape = enforceShape({
    moment, support: i.support ?? "L1_hint", ageMode: i.mode, afterStuck,
    session: i.session ?? { used: 0, budget: ai.response_modes.free_text_budget.per_session },
    model: { response_mode: out.response_mode, options: out.options as RawOption[] | undefined },
    userWords: moment === "goal_what" && afterStuck ? userWordsOf(i, out) : [],
  });
  const final = out.next_question === null && !out.needs_user_confirmation ? { ...shape, response_mode: "free_text" as const, options: [], consumesBudget: false } : shape;
  return { output: { ...out, moment: final.moment, response_mode: final.response_mode, options: final.options }, shape: final };
}

const PLAN_REQUEST = /(اعمل|اعملي|سوّ|سوي|اكتب|اكتبي|حط|ضع)\s*(لي|لى)?\s*(خطة|خطه|جدول)|خطط لي|plan for me/i;

/** AI-15 وقواعد الملحق أ.1: سؤال واحد، لا خطة جاهزة، المسودة بكلمات المستخدم، عمق ≤ الحد، لا دورات. */
export function verifyGoalOutput(out: GoalBuilderOutput, userMessage: string): string | null {
  if (out.next_question && questionMarks(out.next_question) > ai.validation.max_questions_per_reply) return "more_than_one_question";
  if (out.phase !== "done" && !out.next_question) return "question_required_before_done";
  if (PLAN_REQUEST.test(userMessage)) {
    if (!out.next_question) return "plan_request_must_get_question";
    if (out.draft.first_step_user_words && !userMessage.includes(out.draft.first_step_user_words)) return "plan_written_by_model";
  }
  const ids = new Set(out.draft.goals.map((g) => g.temp_id));
  if (ids.size !== out.draft.goals.length) return "duplicate_temp_ids";
  for (const g of out.draft.goals) if (g.parent_temp_id && !ids.has(g.parent_temp_id)) return "dangling_parent";
  // عمق السلسلة ومنع الدورات
  for (const g of out.draft.goals) {
    let depth = 1, cur: string | null = g.parent_temp_id; const seen = new Set<string>([g.temp_id]);
    while (cur) { if (seen.has(cur)) return "cycle"; seen.add(cur); depth++; cur = out.draft.goals.find((x) => x.temp_id === cur)?.parent_temp_id ?? null; if (depth > limits.goal_max_depth) return "too_deep"; }
  }
  return null;
}

/** السقوط الثابت: أسئلة من ملف المحتوى بحسب الدور. */
export function fixedGoalTurn(mode: AgeMode, turn: number, draft: GoalBuilderOutput["draft"] | null, userMessage: string): GoalBuilderOutput {
  const q = fixedQuestions.goal_builder;
  const goals = draft?.goals ?? [];
  if (turn === 0) return { next_question: q.start[mode], reflection_of_user_words: "", thinking_move_named: null, phase: "explore", draft: { goals: [], first_step_user_words: null }, needs_user_confirmation: false, safety: { flag: false, category: null, severity: null } };
  if (goals.length === 0) {
    return { next_question: q.why[mode], reflection_of_user_words: userMessage, thinking_move_named: null, phase: "climb_why", draft: { goals: [{ temp_id: "g1", parent_temp_id: null, title_user_words: userMessage, why_user_words: null }], first_step_user_words: null }, needs_user_confirmation: false, safety: { flag: false, category: null, severity: null } };
  }
  const last = goals[goals.length - 1]!;
  if (!last.why_user_words) {
    const updated = goals.map((g) => (g.temp_id === last.temp_id ? { ...g, why_user_words: userMessage } : g));
    return { next_question: q.first_step[mode], reflection_of_user_words: userMessage, thinking_move_named: "clarify_motive", phase: "descend_how", draft: { goals: updated, first_step_user_words: null }, needs_user_confirmation: false, safety: { flag: false, category: null, severity: null } };
  }
  return { next_question: null, reflection_of_user_words: userMessage, thinking_move_named: "concretize", phase: "confirm", draft: { goals, first_step_user_words: userMessage }, needs_user_confirmation: true, safety: { flag: false, category: null, severity: null } };
}

export async function goalBuilderTurn(i: GoalTurnInput): Promise<{ output: Shaped<GoalBuilderOutput>; source: "ai" | "fixed"; shape: Shape }> {
  const dynamic = `الدور رقم ${i.turn}. المسودة الحالية: ${JSON.stringify(i.draft ?? { goals: [], first_step_user_words: null })}`;
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "goal_builder", profileId: i.profileId,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.goal_builder}`, dynamicSystem: dynamic,
    messages: [...i.history, { role: "user", content: i.userMessage }], schema: goalBuilderOutput,
    verify: (o) => verifyGoalOutput(o, i.userMessage),
    meta: (o) => shapeGoalOutput(i, o).shape.replaced,
  });
  if (r.ok) return { ...shapeGoalOutput(i, r.data), source: "ai" };
  return { ...shapeGoalOutput(i, fixedGoalTurn(i.mode, i.turn, i.draft, i.userMessage)), source: "fixed" };
}
