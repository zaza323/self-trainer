import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ai, type AgeMode } from "@/shared/config";
import type { ModelCaller } from "@/modules/companion/model";
import type { Safety } from "@/modules/companion/schemas";
import { modelSafety } from "./ai";
import { keywordSafety, mergeSafety } from "./classify";
import safeResponses from "@content/safe_responses.ar.json";
import resources from "@content/safety_resources.json";

export type SafetyVerdict = { safety: Safety; detector: "keywords" | "model" | "both" | "none" };

/** يصنّف نصًا واردًا أو صادرًا. النموذج اختياري (يسقط بصمت إلى الكلمات). */
export async function classifyText(db: SupabaseClient, caller: ModelCaller, profileId: string, text: string, direction: "inbound" | "outbound"): Promise<SafetyVerdict> {
  const kw = keywordSafety(text);
  const should = direction === "inbound" ? ai.safety.classify_inbound : ai.safety.classify_outbound;
  if (!should || !caller.enabled) return mergeSafety(kw, { flag: false, category: null, severity: null });
  const m = await modelSafety(db, caller, profileId, text);
  return mergeSafety(kw, m ?? { flag: false, category: null, severity: null });
}

/** الرد الآمن المكتوب مسبقًا حسب الفئة والوضع + موارد المساعدة للبالغ. */
export function safeResponse(category: NonNullable<Safety["category"]>, mode: AgeMode, country = resources.default_country): string {
  const base = (safeResponses as unknown as Record<string, Record<AgeMode, string>>)[category]![mode];
  if (mode !== "adult") return base;
  const c = (resources.countries as Record<string, { verified: boolean; resources: Array<{ label: string; value: string }> }>)[country];
  if (!c) return base;
  const lines = c.resources.map((r) => `${r.label}: ${r.value}`).join("\n");
  return `${base}\n${lines}${c.verified ? "" : `\n${resources.unverified_notice}`}`;
}

/**
 * AI-5 / 7.4: تسجيل العلم، تنبيه كل مربٍ لديه receive_alerts فورًا (خارج حدود الإشعارات)، والتصعيد للمشرف (status=open).
 * يعود بعدد المربين المُبلَّغين. التنفيذ متزامن حتى يصل التنبيه خلال ثوانٍ (< 60 ثانية).
 */
export async function raiseSafetyFlag(admin: SupabaseClient, args: { profileId: string; sessionId: string | null; messageId: string | null; direction: "inbound" | "outbound"; verdict: SafetyVerdict }): Promise<{ flagId: string; notified: number }> {
  const s = args.verdict.safety;
  const { data, error } = await admin.from("safety_flags").insert({ profile_id: args.profileId, session_id: args.sessionId, message_id: args.messageId, direction: args.direction, category: s.category, severity: s.severity ?? "medium", detector: args.verdict.detector }).select("id").single();
  if (error || !data) throw error ?? new Error("flag insert failed");
  const flagId = data.id as string;
  const { data: n } = await admin.rpc("notify_safety", { p_flag_id: flagId });
  return { flagId, notified: Number(n ?? 0) };
}
