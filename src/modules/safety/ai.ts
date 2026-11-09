/** طبقة الذكاء الاصطناعي (0.5 RULES-2): مصنّف الأمان بالنموذج فقط. لا كتابة إلا ai_calls عبر runFunction. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelCaller } from "@/modules/companion/model";
import { runFunction } from "@/modules/companion/runtime";
import { FUNCTION_INSTRUCTIONS } from "@/modules/companion/prompts";
import { safetyClassifierOutput, type Safety } from "@/modules/companion/schemas";

/** حكم النموذج، أو null إن تعذّر (الخادم يكمل بقوائم الكلمات). */
export async function modelSafety(db: SupabaseClient, caller: ModelCaller, profileId: string, text: string): Promise<Safety | null> {
  const r = await runFunction({ db, caller, fn: "safety_classifier", profileId, system: FUNCTION_INSTRUCTIONS.safety_classifier, messages: [{ role: "user", content: text }], schema: safetyClassifierOutput });
  return r.ok ? r.data : null;
}
