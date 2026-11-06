import type { ChoiceOption } from "./options";

export type InputMethod = "typed" | "voice" | "option";

/** يحلّ ردّ المستخدم من الشكل المرسل: خيار (بمعرّفه من آخر رسالة للمرافق) أو نص مكتوب/صوتي. */
export function resolveAnswerSafe(raw: { text: string; optionId: string | null; method: InputMethod }, lastOptions: ChoiceOption[]): { ok: true; text: string; method: InputMethod; optionId: string | null } | { ok: false } {
  if (raw.method === "option") {
    const opt = lastOptions.find((o) => o.id === raw.optionId);
    return opt ? { ok: true, text: opt.label, method: "option", optionId: opt.id } : { ok: false };
  }
  return { ok: true, text: raw.text, method: raw.method, optionId: null };
}
