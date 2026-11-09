import "server-only";
/**
 * AI-3 (0.5 RULES-3): مؤشرات المحادثة يقترحها الذكاء الاصطناعي، والقواعد هنا تقرر: القدرة من القائمة، القيمة مقصوصة إلى [−1، 1]،
 * الثقة إلى [0، 1] وتصبح rule_weight، والوزن من evidenceWeight (المصدر companion منخفض الوزن). لا شيء آخر يُكتب.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAPABILITY_IDS, CONFIG_VERSION, type SupportLevel } from "@/shared/config";
import { evidenceWeight } from "./rules";

export type InsightCandidate = { capability_id: string; type: string; value: number; confidence: number };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));

export function acceptInsights(c: InsightCandidate[]): InsightCandidate[] {
  return c.filter((i) => (CAPABILITY_IDS as readonly string[]).includes(i.capability_id)).map((i) => ({ ...i, value: clamp(i.value, -1, 1), confidence: clamp(i.confidence, 0, 1) }));
}

export async function recordCompanionInsights(admin: SupabaseClient, i: { profileId: string; sessionId: string; support: SupportLevel; candidates: InsightCandidate[] }): Promise<number> {
  const ok = acceptInsights(i.candidates);
  if (!ok.length) return 0;
  await admin.from("companion_insights").insert(ok.map((x) => ({ session_id: i.sessionId, profile_id: i.profileId, capability_id: x.capability_id, type: x.type, value: x.value, confidence: x.confidence })));
  await admin.from("evidence_events").insert(ok.map((x) => ({ profile_id: i.profileId, mission_id: null, capability_id: x.capability_id, rule_id: "companion", source: "companion", type: "companion_insight", value: x.value, rule_weight: x.confidence, weight: evidenceWeight("companion", i.support, x.confidence), context_tag: "chat", support_level: i.support, config_version: CONFIG_VERSION })));
  return ok.length;
}
