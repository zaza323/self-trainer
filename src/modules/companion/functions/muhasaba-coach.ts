import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "../prompts";
import { reflectionCoachOutput, type ReflectionCoachOutput } from "../schemas";
import { isSelfBlame, reframeLine, replyAffirmsBlame } from "@/modules/muhasaba/flow";

export type MuhasabaCoachInput = { db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode; shortfallText: string | null; reasonText: string };
export type MuhasabaCoachResult = { reply: string; candidates: ReflectionCoachOutput["evidence_candidates"]; source: "ai" | "fixed"; selfBlame: boolean };

/** ز.2/ز.5: سبب التقصير المكتوب ⇒ مرشح M1 عبر reflection_coach (مصدر ai)؛ جلد الذات يُعاد للسلوك المحدد، ورد يؤكد الحكم يُرفض. */
export function verifyMuhasabaReply(out: ReflectionCoachOutput): string | null {
  if (out.next_question && replyAffirmsBlame(out.next_question)) return "affirms_self_blame";
  if (out.reflection_summary_user_words && replyAffirmsBlame(out.reflection_summary_user_words)) return "affirms_self_blame";
  for (const c of out.evidence_candidates) if (c.capability_id !== "self_awareness") return "candidate_capability_not_allowed";
  return null;
}

export async function muhasabaCoach(i: MuhasabaCoachInput): Promise<MuhasabaCoachResult> {
  const selfBlame = isSelfBlame(i.reasonText);
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "reflection_coach", profileId: i.profileId,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.muhasaba_coach}`,
    dynamicSystem: `التقصير: ${i.shortfallText ?? "—"}. ${selfBlame ? "المستخدم يجلد ذاته: اعكس كلامه بلطف وأعده إلى السلوك المحدد، ولا تؤكد الحكم." : ""}`,
    messages: [{ role: "user", content: i.reasonText }], schema: reflectionCoachOutput, verify: verifyMuhasabaReply,
  });
  if (r.ok) return { reply: r.data.next_question ?? r.data.reflection_summary_user_words ?? "", candidates: r.data.evidence_candidates, source: "ai", selfBlame };
  return { reply: reframeLine(i.mode, i.shortfallText), candidates: [], source: "fixed", selfBlame };
}
