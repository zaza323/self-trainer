import "server-only";
/**
 * أدلة الوعي من الكتابة الحرة بمرشح reflection_coach (مصدر ai): D2 (التأمل المسائي)، R2 («شو لفت نظرك؟»)، R3 (فحص الغايات).
 * rule_weight 0.5 وحد 3 يوميًا لكل قدرة (recordPlannerEvidence). بلا نموذج ⇒ لا دليل (المصدر ai لا يُخترع).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode, CapabilityId } from "@/shared/config";
import type { ModelCaller } from "@/modules/companion/model";
import { recordPlannerEvidence } from "./evidence-service";
import { awarenessCandidate } from "./reflection-ai";

export type FreeTextRule = "D2" | "R2" | "R3";
export async function evidenceFromFreeText(admin: SupabaseClient, caller: ModelCaller, p: { id: string; age_mode: AgeMode }, i: { ruleId: FreeTextRule; capability: CapabilityId; text: string; dedupeKey: string; context: string; now?: Date }): Promise<{ recorded: boolean; value: number | null }> {
  const text = i.text.trim();
  if (!text) return { recorded: false, value: null };
  // الذكاء الاصطناعي يقترح مرشحًا فقط؛ القواعد (recordPlannerEvidence: الوزن، القص، حد 3 يوميًا) تقرر وتسجل
  const value = await awarenessCandidate(admin, caller, p, { capability: i.capability, text, context: i.context, now: i.now });
  if (value === null) return { recorded: false, value: null };
  const recorded = await recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: i.ruleId, capability: i.capability, type: "reflection_quality", source: "ai", value, dedupeKey: i.dedupeKey }, i.now);
  return { recorded, value };
}
