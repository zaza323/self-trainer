import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG_VERSION, planner, support as supportCfg, type AgeMode, type CapabilityId, type SupportLevel } from "@/shared/config";
import { evidenceWeight, type EvidenceSource, type EvidenceType } from "@/modules/evidence/rules";

type Admin = SupabaseClient;
const bridge = planner.evidence_bridge as unknown as { rule_weight: number; daily_cap_per_capability: number };
export const PLANNER_RULE_PREFIX = /^(P|D|F|M|R)\d$/;

export type PlannerEvidenceInput = {
  profileId: string; ageMode: AgeMode; ruleId: string; capability: CapabilityId; type: EvidenceType; source: EvidenceSource;
  value: number; contextTag?: string; plannerTaskId?: string | null; ruleWeight?: number;
  /** مفتاح تكرار (لا يُحفظ عمودًا؛ يُدمج في rule_id كـ rule:key حتى لا يتكرر الدليل نفسه) */
  dedupeKey?: string;
};

/**
 * أدلة المخطط الخفيفة (ب.11، ج.8، د.7، ز.5، ط.8): rule_weight 0.5، حد 3 أدلة يوميًا لكل قدرة من المخطط، لا قيمة سلبية
 * إلا لأدلة الوعي بالتوقّع (R1/P1) حيث القيمة من المعادلة نفسها. يعيد true إن سُجّل.
 */
export async function recordPlannerEvidence(admin: Admin, i: PlannerEvidenceInput, now = new Date()): Promise<boolean> {
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const { data: today } = await admin.from("evidence_events").select("rule_id").eq("profile_id", i.profileId).eq("capability_id", i.capability).is("mission_id", null).gte("created_at", dayStart.toISOString());
  const plannerToday = ((today ?? []) as Array<{ rule_id: string }>).filter((r) => PLANNER_RULE_PREFIX.test(r.rule_id.split(":")[0] ?? ""));
  if (plannerToday.length >= bridge.daily_cap_per_capability) return false;
  const ruleId = i.dedupeKey ? `${i.ruleId}:${i.dedupeKey}` : i.ruleId;
  if (i.dedupeKey) {
    const { data: dup } = await admin.from("evidence_events").select("id").eq("profile_id", i.profileId).eq("rule_id", ruleId).limit(1);
    if (dup?.length) return false;
  }
  const { data: st } = await admin.from("capability_states").select("support_level").eq("profile_id", i.profileId).eq("capability_id", i.capability).maybeSingle();
  const supportLevel: SupportLevel = ((st as { support_level: SupportLevel } | null)?.support_level) ?? supportCfg.initial_by_age_mode[i.ageMode];
  const ruleWeight = i.ruleWeight ?? bridge.rule_weight;
  const value = Math.max(-1, Math.min(1, i.value));
  const { error } = await admin.from("evidence_events").insert({
    profile_id: i.profileId, mission_id: null, planner_task_id: i.plannerTaskId ?? null, capability_id: i.capability, rule_id: ruleId, source: i.source, type: i.type,
    value, rule_weight: ruleWeight, weight: evidenceWeight(i.source, supportLevel, ruleWeight), context_tag: i.contextTag ?? "planner", support_level: supportLevel, config_version: CONFIG_VERSION, created_at: now.toISOString(),
  });
  return !error;
}

/** مؤشر مستوى الدعم لقدرة (لشرط L2+ في F1). */
export async function supportIndexFor(admin: Admin, profileId: string, capability: CapabilityId, ageMode: AgeMode): Promise<number> {
  const { data: st } = await admin.from("capability_states").select("support_level").eq("profile_id", profileId).eq("capability_id", capability).maybeSingle();
  const lvl: SupportLevel = ((st as { support_level: SupportLevel } | null)?.support_level) ?? supportCfg.initial_by_age_mode[ageMode];
  return ["L0_instruct", "L1_hint", "L2_ask", "L3_free"].indexOf(lvl);
}
