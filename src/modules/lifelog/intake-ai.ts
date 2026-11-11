/**
 * life_intake_assistant (0.5 أ.4) — طبقة الذكاء الاصطناعي: يستخرج مرشحين من رسالة المستخدم ويقترح متابعة واحدة.
 * لا يكتب شيئًا (عدا ai_calls عبر runFunction). الخادم يتحقق: النص جزء حرفي من الرسالة وإلا يُحذف المرشح، الحقل مسموح،
 * ≤ 3 مرشحين، والمتابعة سؤال واحد ≤ 80 حرفًا. المرشحون يصيرون context_suggestions ببطاقة تأكيد في المنسّق.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AgeMode } from "@/shared/config";
import type { ModelCaller } from "@/modules/companion/model";
import { runFunction } from "@/modules/companion/runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "@/modules/companion/prompts";
import { questionMarks } from "@/modules/companion/schemas";
import { LIFE_FIELDS, isVerbatim, blockedReason, type LifeField } from "./rules";

export const MAX_CANDIDATES = 3;
export const FOLLOW_UP_MAX_CHARS = 80;
export const lifeIntakeOutput = z.object({
  candidates: z.array(z.object({ field: z.string(), text: z.string().min(1).max(200) })).max(10),
  follow_up: z.string().max(300).nullable(),
});
export type LifeIntakeOutput = z.infer<typeof lifeIntakeOutput>;
export type IntakeCandidate = { field: LifeField; text: string };

/** قواعد الخادم على مخرج النموذج (نقية): تُسقط ما ليس حرفيًا أو ممنوعًا أو خارج الحقول، وتقص العدد، وتُهمل متابعة مخالفة. */
export function applyIntakeRules(out: LifeIntakeOutput, i: { userMessage: string; field: LifeField; existing: string[] }): { candidates: IntakeCandidate[]; followUp: string | null; dropped: Array<{ text: string; reason: string }> } {
  const dropped: Array<{ text: string; reason: string }> = [];
  const seen = new Set(i.existing.map((t) => t.trim()));
  const candidates: IntakeCandidate[] = [];
  for (const c of out.candidates) {
    const text = c.text.trim();
    if (!(LIFE_FIELDS as readonly string[]).includes(c.field)) { dropped.push({ text, reason: "field_not_allowed" }); continue; }
    if (!isVerbatim(text, i.userMessage)) { dropped.push({ text, reason: "not_verbatim" }); continue; }
    if (blockedReason(text)) { dropped.push({ text, reason: "blocked" }); continue; }
    if (seen.has(text)) { dropped.push({ text, reason: "duplicate" }); continue; }
    if (candidates.length >= MAX_CANDIDATES) { dropped.push({ text, reason: "max_candidates" }); continue; }
    seen.add(text);
    candidates.push({ field: c.field as LifeField, text });
  }
  const f = out.follow_up?.trim() ?? "";
  const followUp = f && f.length <= FOLLOW_UP_MAX_CHARS && questionMarks(f) === 1 ? f : null;
  return { candidates, followUp, dropped };
}

export async function lifeIntakeAssist(i: { db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode; field: LifeField; userMessage: string; existing: string[]; allowFollowUp: boolean; now?: Date }): Promise<{ candidates: IntakeCandidate[]; followUp: string | null; source: "ai" | "fixed" }> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "life_intake_assistant", profileId: i.profileId, now: i.now,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.life_intake_assistant}`,
    // لا يُرسل من السجل إلا عناصر الحقل المطلوب (أ.7)
    dynamicSystem: `الحقل المطلوب: ${i.field}. عناصره الحالية: ${JSON.stringify(i.existing)}. ${i.allowFollowUp ? "" : "لا متابعة: اجعل follow_up = null."}`,
    messages: [{ role: "user", content: i.userMessage }], schema: lifeIntakeOutput,
  });
  if (!r.ok) return { candidates: [], followUp: null, source: "fixed" };
  const a = applyIntakeRules(r.data, { userMessage: i.userMessage, field: i.field, existing: i.existing });
  return { candidates: a.candidates, followUp: i.allowFollowUp ? a.followUp : null, source: "ai" };
}
