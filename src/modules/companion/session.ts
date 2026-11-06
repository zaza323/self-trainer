import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { support as supportConfig, type AgeMode, type CapabilityId, type SupportLevel } from "@/shared/config";
import { effective } from "@/modules/settings";
import { localParts } from "@/modules/notifications/plan";
import { freeTextBudget } from "./response-mode";

/** ميزانية الكتابة للجلسة (أ.4): تُحسب عند أول استخدام وتُحفظ، فلا تتغير في منتصف الجلسة. */
export async function loadSessionBudget(admin: SupabaseClient, sessionId: string, profile: { id: string; timezone: string }, sessionMode: string, now = new Date()): Promise<{ used: number; budget: number }> {
  const { data } = await admin.from("companion_sessions").select("free_text_budget, free_text_used").eq("id", sessionId).single();
  const row = data as { free_text_budget: number | null; free_text_used: number } | null;
  if (row?.free_text_budget !== null && row?.free_text_budget !== undefined) return { used: row.free_text_used, budget: row.free_text_budget };
  const prefer = await effective<boolean>(admin, profile.id, "companion_prefer_choices");
  const budget = freeTextBudget({ localTime: localParts(now, profile.timezone).hhmm, comebackSession: sessionMode === "comeback", preferChoices: prefer.value });
  await admin.from("companion_sessions").update({ free_text_budget: budget }).eq("id", sessionId);
  return { used: row?.free_text_used ?? 0, budget };
}

export async function consumeFreeText(admin: SupabaseClient, sessionId: string, usedNow: number): Promise<void> {
  await admin.from("companion_sessions").update({ free_text_used: usedNow + 1 }).eq("id", sessionId);
}

/** مستوى دعم قدرة معيّنة (الافتراضي حسب الوضع العمري إن لم تُسجَّل حالة بعد). */
export async function supportFor(admin: SupabaseClient, profileId: string, capability: CapabilityId, mode: AgeMode): Promise<SupportLevel> {
  const { data } = await admin.from("capability_states").select("support_level").eq("profile_id", profileId).eq("capability_id", capability).maybeSingle();
  return ((data as { support_level: SupportLevel } | null)?.support_level) ?? supportConfig.initial_by_age_mode[mode];
}
