import { ai, type AgeMode, type Moment, type ResponseMode, type SupportLevel } from "@/shared/config";
import { applyBudget, consumesBudget, maxOptionsFor, policyMode } from "./policy";
import { buildOptions, type ChoiceOption, type RawOption } from "./options";

export type ShapeInput = {
  moment: Moment;
  support: SupportLevel;
  ageMode: AgeMode;
  afterStuck: boolean;
  session: { used: number; budget: number };
  /** ما اقترحه النموذج (قد يخالف السياسة) */
  model: { response_mode?: ResponseMode; options?: RawOption[] };
  userWords?: string[];
  template?: string[];
};

export type Shape = {
  moment: Moment;
  response_mode: ResponseMode;
  options: ChoiceOption[];
  /** هل يُحتسب هذا السؤال من ميزانية الكتابة (يزيد free_text_used)؟ */
  consumesBudget: boolean;
  /** سجل الاستبدال لـ ai_calls.meta (أ.7)؛ null إن طابق النموذج السياسة */
  replaced: { model_mode: ResponseMode | null; final_mode: ResponseMode; reasons: string[] } | null;
};

/** الخادم يحسب الشكل المسموح من السياسة ويستبدل شكل النموذج إن خالفها (أ.7). */
export function enforceShape(i: ShapeInput): Shape {
  const reasons: string[] = [];
  const base = policyMode(i);
  const mode = applyBudget(base, i.moment, i.session.used, i.session.budget);
  if (mode !== base) reasons.push("free_text_budget_exhausted");

  let options: ChoiceOption[] = [];
  if (mode !== "free_text") {
    const built = buildOptions({ moment: i.moment, max: maxOptionsFor(i.moment, i.afterStuck), model: i.model.options ?? [], userWords: i.userWords ?? [], template: i.template ?? [] });
    options = built.options;
    if (built.reason) reasons.push(`options_${built.reason}`);
  } else if (i.moment === "free_chat") {
    // اختصارات اختيارية حتى optional_shortcuts_max (لا تُملأ هنا؛ الدردشة المبثوثة لا تولّدها في هذه النسخة)
    options = [];
  }

  const modelMode = i.model.response_mode ?? null;
  if (modelMode && modelMode !== mode) reasons.push("model_mode_overridden");
  const budgetUsed = mode === "free_text" && consumesBudget(i.moment);
  return {
    moment: i.moment, response_mode: mode, options, consumesBudget: budgetUsed,
    replaced: reasons.length ? { model_mode: modelMode, final_mode: mode, reasons } : null,
  };
}

/** سقف الخيارات الصلب للواجهة/الاختبارات. */
export const RESPONSE_OPTIONS_MAX = ai.response_modes.options.max;
