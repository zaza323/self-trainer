/**
 * طبقة الذكاء الاصطناعي (0.5 RULES-2): مرشح الوعي من كتابة حرة عبر reflection_coach. يعيد المرشح فقط؛
 * تسجيل الدليل قرار قواعد خارج هذه الطبقة (reflection-evidence.ts → recordPlannerEvidence).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode, CapabilityId } from "@/shared/config";
import type { ModelCaller } from "@/modules/companion/model";
import { runFunction } from "@/modules/companion/runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "@/modules/companion/prompts";
import { reflectionCoachOutput } from "@/modules/companion/schemas";

export async function awarenessCandidate(db: SupabaseClient, caller: ModelCaller, p: { id: string; age_mode: AgeMode }, i: { capability: CapabilityId; text: string; context: string; now?: Date }): Promise<number | null> {
  const r = await runFunction({
    db, caller, fn: "reflection_coach", profileId: p.id,
    system: `${personaSystem(p.age_mode)}\n\n${FUNCTION_INSTRUCTIONS.reflection_coach}`,
    dynamicSystem: `${i.context} قيّم فقط: evidence_candidates بحد أقصى مرشح واحد على ${i.capability}، وdone=true. لا دليل سلبي من السلوك نفسه؛ ما يُقاس هو الوعي.`,
    messages: [{ role: "user", content: i.text }], schema: reflectionCoachOutput,
    verify: (o) => (o.evidence_candidates.some((c) => c.capability_id !== i.capability) ? "candidate_capability_not_allowed" : null),
    now: i.now,
  });
  return r.ok && r.data.evidence_candidates.length ? r.data.evidence_candidates[0]!.value : null;
}
