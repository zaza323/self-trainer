import "server-only";
/**
 * أدلة الوعي من الكتابة الحرة بمرشح reflection_coach (مصدر ai): D2 (التأمل المسائي)، R2 («شو لفت نظرك؟»)، R3 (فحص الغايات).
 * rule_weight 0.5 وحد 3 يوميًا لكل قدرة (recordPlannerEvidence). بلا نموذج ⇒ لا دليل (المصدر ai لا يُخترع).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode, CapabilityId } from "@/shared/config";
import type { ModelCaller } from "@/modules/companion/model";
import { runFunction } from "@/modules/companion/runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "@/modules/companion/prompts";
import { reflectionCoachOutput } from "@/modules/companion/schemas";
import { recordPlannerEvidence } from "./evidence-service";

export type FreeTextRule = "D2" | "R2" | "R3";
export async function evidenceFromFreeText(admin: SupabaseClient, caller: ModelCaller, p: { id: string; age_mode: AgeMode }, i: { ruleId: FreeTextRule; capability: CapabilityId; text: string; dedupeKey: string; context: string; now?: Date }): Promise<{ recorded: boolean; value: number | null }> {
  const text = i.text.trim();
  if (!text) return { recorded: false, value: null };
  const r = await runFunction({
    db: admin, caller, fn: "reflection_coach", profileId: p.id,
    system: `${personaSystem(p.age_mode)}\n\n${FUNCTION_INSTRUCTIONS.reflection_coach}`,
    dynamicSystem: `${i.context} قيّم فقط: evidence_candidates بحد أقصى مرشح واحد على ${i.capability}، وdone=true. لا دليل سلبي من السلوك نفسه؛ ما يُقاس هو الوعي.`,
    messages: [{ role: "user", content: text }], schema: reflectionCoachOutput,
    verify: (o) => (o.evidence_candidates.some((c) => c.capability_id !== i.capability) ? "candidate_capability_not_allowed" : null),
    now: i.now,
  });
  if (!r.ok || !r.data.evidence_candidates.length) return { recorded: false, value: null };
  const value = r.data.evidence_candidates[0]!.value;
  const recorded = await recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: i.ruleId, capability: i.capability, type: "reflection_quality", source: "ai", value, dedupeKey: i.dedupeKey }, i.now);
  return { recorded, value };
}
