import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scoring, game, limits, CONFIG_VERSION, type AgeMode, type SupportLevel, type CapabilityId, type MechanicId } from "@/shared/config";
import { evidenceWeight } from "@/modules/evidence";
import { primaryCapability, loadTemplate, type MissionTemplate } from "@/modules/library";
import { effective } from "@/modules/settings";
import realMissions from "@content/real_missions.ar.json";
import observations from "@content/guardian_observations.ar.json";
import mechanics from "@content/mechanics.ar.json";

/** قالب مخصص لمهمة واقعية (LIFE-3، MIS-2، MIS-10) مملوك للملف. يُنشأ بعميل الخدمة لأن القوالب لا تُدرج من المتصفح. */
export type CustomTaskInput = {
  profileId: string; mode: AgeMode; createdBy: string;
  title: string; situation: string; mechanic: MechanicId;
  capabilityWeights?: Record<string, number>; reflectionPrompts?: string[];
  trainingLevel: "guided_real" | "independent_real";
  minutes?: number;
};

export async function createCustomTemplate(admin: SupabaseClient, i: CustomTaskInput): Promise<{ id: string; version: number }> {
  const primary = (mechanics as Record<string, { primary_capability?: string }>)[i.mechanic]?.primary_capability ?? "autonomy";
  const weights = i.capabilityWeights && Object.keys(i.capabilityWeights).length ? i.capabilityWeights : { [primary]: 1 };
  const id = `cu-${i.trainingLevel === "guided_real" ? "real" : "ind"}-${Math.random().toString(36).slice(2, 8)}`;
  const minutes = Math.max(5, Math.min(180, i.minutes ?? 20));
  const rules = [{ id: "r1", type: "strategy_fit", capability_id: primary, source: "auto", value: { kind: "strategy_fit" } }];
  const { error } = await admin.from("mission_templates").insert({
    id, version: 1, mechanic_id: i.mechanic, training_level: i.trainingLevel, difficulty: 2, age_modes: [i.mode],
    title_by_mode: i.title, situation_by_mode: i.situation, variable_defaults: { time_budget: minutes },
    strategies: [{ id: "s1", text: "أخطط خطوة أولى صغيرة ثم أبدأ", fit: 0.7 }, { id: "s2", text: "أبدأ فورًا وأرى ما يحدث", fit: 0.1 }, { id: "s3", text: "أحدد وقتًا ومكانًا قبل البدء", fit: 0.7 }],
    prediction_prompt: "كم دقيقة ستستغرق؟", reflection_prompts: i.reflectionPrompts?.length ? i.reflectionPrompts : realMissions.default_reflection,
    hints_by_level: {}, evidence_rules: [...rules, { id: "r2", type: "prediction_accuracy", capability_id: "self_awareness", source: "auto", value: { kind: "prediction_error", tolerance: scoring.value_defaults.prediction_tolerance } }],
    completion_check: "self_report", min_duration: minutes, max_duration: minutes * 2, status: "active", origin: "human", owner_profile_id: i.profileId, created_by: i.createdBy,
  });
  if (error) throw error;
  const caps = Object.entries(weights).map(([capability_id, weight]) => ({ template_id: id, template_version: 1, capability_id, weight }));
  if (!caps.some((c) => c.capability_id === "self_awareness")) caps.push({ template_id: id, template_version: 1, capability_id: "self_awareness", weight: 0 });
  // self_awareness بوزن 0 غير مسموح (weight > 0) → نعيد التوزيع إن لم تكن موجودة
  const total = caps.filter((c) => c.weight > 0).reduce((s, c) => s + c.weight, 0);
  const normalized = caps.filter((c) => c.weight > 0).map((c) => ({ ...c, weight: Math.round((c.weight / total) * 100) / 100 }));
  const { error: e2 } = await admin.from("template_capabilities").insert(normalized);
  if (e2) throw e2;
  return { id, version: 1 };
}

/** هل تحتاج مهمة كتبها المتدرب موافقة المربي؟ (MIS-2: child مع الإعداد) */
export async function selfMissionNeedsApproval(db: SupabaseClient, profileId: string, mode: AgeMode): Promise<boolean> {
  if (mode !== "child") return false;
  return (await effective<boolean>(db, profileId, "self_missions_require_approval")).value;
}

/** MIS-10: إدراج مهام الجداول المتكررة المستحقة اليوم (تُحتسب ضمن العدد اليومي لا فوقه). */
export async function materializeSchedules(db: SupabaseClient, profileId: string, today: string, weekday: number): Promise<number> {
  const { data: schedules } = await db.from("mission_schedules").select("id, template_id, template_version, days_of_week, created_by").eq("profile_id", profileId).eq("active", true);
  let n = 0;
  for (const s of (schedules ?? []) as Array<{ id: string; template_id: string; template_version: number; days_of_week: number[]; created_by: string }>) {
    if (!s.days_of_week.includes(weekday)) continue;
    const { data: existing } = await db.from("missions").select("id").eq("schedule_id", s.id).eq("suggested_for", today).limit(1);
    if (existing?.length) continue;
    const { data: st } = await db.from("capability_states").select("support_level").eq("profile_id", profileId).limit(1);
    const { data: t } = await db.from("mission_templates").select("difficulty, variable_defaults").eq("id", s.template_id).eq("version", s.template_version).single();
    const { error } = await db.from("missions").insert({ profile_id: profileId, template_id: s.template_id, template_version: s.template_version, status: "suggested", difficulty: (t?.difficulty as number) ?? 2, support_level: ((st ?? [])[0]?.support_level as string) ?? "L1_hint", variables: (t?.variable_defaults as Record<string, unknown>) ?? {}, source: "guardian_recurring", schedule_id: s.id, suggested_for: today, created_by: s.created_by });
    if (!error) n++;
  }
  return n;
}

/** LIFE-1: دعوة واحدة للتعميم بعد كل مهمة واقعية خلال 1–3 أيام (إشعار مجدول). */
export async function scheduleTransferInvite(admin: SupabaseClient, profileId: string, missionId: string, trainingLevel: string, now = new Date()): Promise<boolean> {
  if (trainingLevel !== "guided_real" && trainingLevel !== "independent_real") return false;
  const { data: exists } = await admin.from("notifications").select("id").eq("profile_id", profileId).eq("type", "transfer_invite").contains("payload", { mission_id: missionId }).limit(1);
  if (exists?.length) return false;
  const days = limits.chat.transfer_invite_days;
  const d = days[Math.abs(hash(missionId)) % days.length] ?? 1;
  await admin.from("notifications").insert({ profile_id: profileId, type: "transfer_invite", scheduled_for: new Date(now.getTime() + d * 86400000).toISOString(), payload: { mission_id: missionId, question: realMissions.transfer.invite } });
  return true;
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

/**
 * LIFE-2: بعد إدراج تقرير النقل بعميل المتدرب — المهمة → transferred، دليل transfer_report (self)، XP (أ.8).
 */
export async function afterTransferReport(admin: SupabaseClient, report: { id: string; profile_id: string; mission_id: string | null; capability_id: string; context_tag: string; worked: boolean }): Promise<void> {
  const v = report.worked ? scoring.value_defaults.transfer_report.worked : scoring.value_defaults.transfer_report.not_worked;
  const { data: st } = await admin.from("capability_states").select("support_level").eq("profile_id", report.profile_id).eq("capability_id", report.capability_id).maybeSingle();
  const support = ((st?.support_level as SupportLevel) ?? "L2_ask");
  await admin.from("evidence_events").upsert({ profile_id: report.profile_id, mission_id: report.mission_id, capability_id: report.capability_id, rule_id: "T1", source: "self", type: "transfer_report", value: v, rule_weight: 1, weight: evidenceWeight("self", support, 1), context_tag: report.context_tag, support_level: support, config_version: CONFIG_VERSION }, { onConflict: "mission_id,capability_id,type", ignoreDuplicates: true });
  if (report.mission_id) {
    const { data: m } = await admin.from("missions").select("status").eq("id", report.mission_id).single();
    if (m?.status === "reflected") await admin.from("missions").update({ status: "transferred" }).eq("id", report.mission_id);
  }
  await admin.from("xp_events").upsert({ profile_id: report.profile_id, amount: game.xp.rewards.transfer_report, reason: "transfer_report", source_id: report.id }, { onConflict: "reason,source_id", ignoreDuplicates: true });
}

/** تأكيد المربي: دليل إضافي بوزن المربي (خارج المهمة لتجنب التكرار) + XP إضافية. */
export async function afterTransferConfirmed(admin: SupabaseClient, report: { id: string; profile_id: string; capability_id: string; context_tag: string; worked: boolean }): Promise<void> {
  const v = report.worked ? scoring.value_defaults.transfer_report.worked : scoring.value_defaults.transfer_report.not_worked;
  const { data: st } = await admin.from("capability_states").select("support_level").eq("profile_id", report.profile_id).eq("capability_id", report.capability_id).maybeSingle();
  const support = ((st?.support_level as SupportLevel) ?? "L2_ask");
  await admin.from("evidence_events").insert({ profile_id: report.profile_id, mission_id: null, capability_id: report.capability_id, rule_id: "T2", source: "guardian", type: "transfer_report", value: v, rule_weight: 1, weight: evidenceWeight("guardian", support, 1), context_tag: report.context_tag, support_level: support, config_version: CONFIG_VERSION });
  await admin.from("xp_events").upsert({ profile_id: report.profile_id, amount: game.xp.rewards.transfer_guardian_confirmed, reason: "transfer_guardian_confirmed", source_id: report.id }, { onConflict: "reason,source_id", ignoreDuplicates: true });
}

/** GUARD-3: ملاحظة مربٍ بصيغة محددة → دليل guardian_observation (المصدر guardian، خارج المهام). */
export async function afterObservation(admin: SupabaseClient, obs: { id: string; profile_id: string; capability_id: string; observation_type: string; context_tag: string }): Promise<void> {
  const t = (observations.types as Record<string, { capability: string; valence: "positive" | "mixed" | "needs_support" }>)[obs.observation_type];
  if (!t) return;
  const v = scoring.value_defaults.guardian_observation[t.valence];
  const { data: st } = await admin.from("capability_states").select("support_level").eq("profile_id", obs.profile_id).eq("capability_id", obs.capability_id).maybeSingle();
  const support = ((st?.support_level as SupportLevel) ?? "L2_ask");
  await admin.from("evidence_events").insert({ profile_id: obs.profile_id, mission_id: null, capability_id: obs.capability_id, rule_id: `GO:${obs.id.slice(0, 8)}`, source: "guardian", type: "guardian_observation", value: v, rule_weight: 1, weight: evidenceWeight("guardian", support, 1), context_tag: obs.context_tag, support_level: support, config_version: CONFIG_VERSION });
}

export function observationCapability(type: string): CapabilityId | null {
  const t = (observations.types as Record<string, { capability: string }>)[type];
  return (t?.capability as CapabilityId) ?? null;
}

export async function templateFor(db: SupabaseClient, id: string, version: number): Promise<MissionTemplate | null> { return loadTemplate(db, id, version); }
export { primaryCapability };
