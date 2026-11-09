// ملف ذكاء اصطناعي مخالف عمدًا لاختبار المدقق (لا يُستورد في التطبيق).
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPlannerEvidence } from "@/modules/planner/evidence-service";
export async function grant(db: SupabaseClient) { await db.from("xp_events").insert({ amount: 500 }); return recordPlannerEvidence; }
