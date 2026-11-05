import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAPABILITY_IDS, CONFIG_VERSION, type CapabilityId, type SupportLevel, type TrainingLevel } from "@/shared/config";
import { loadTemplate, primaryCapability, type MissionTemplate } from "@/modules/library";
import { computeCapabilityScore, confidenceBand, scoreBand, decideSupport, decideTraining, applyMasteryCheck, nextMasteryCheckDate, type CapMissionSummary } from "@/modules/capabilities";
import { missionXp, applyDailyCap } from "@/modules/game";
import { evaluateMission, type EvidenceCandidate } from "./rules";
import { support as supportCfg } from "@/shared/config";

/**
 * تقييم مهمة عند الانتقال إلى reflected وكتابة النتائج (GATE-2..6، أ.5، أ.6، أ.8).
 * يعمل بعميل service_role: المتصفح لا يكتب الأدلة أبدًا. كل الكتابات idempotent (القيود الفريدة):
 * إعادة التشغيل على المهمة نفسها لا تكرر أدلة ولا XP (أ.11 اختبار 5).
 */
export type EvaluationReport = { mission_id: string; gate2: string; gate2_score: number; events: number; xp: number; support_changes: string[]; training_changes: string[] };

type MissionRowLite = {
  id: string; profile_id: string; template_id: string; template_version: number; status: string; gate1: boolean | null; gate2: string | null;
  support_level: SupportLevel; difficulty: number; strategy_chosen: string | null; custom_strategy: string | null; prediction: { minutes?: number; count?: number } | null;
  actual_duration_min: number | null; hints_used: number; distraction_log: Array<{ choice: "ignore" | "break_return" | "give_in" }>;
  interruption_reasons: unknown[]; context_tag: string | null; is_mastery_check: boolean; created_at: string;
};

export async function evaluateAndRecord(admin: SupabaseClient, missionId: string, opts: { customStrategyFit?: number | null; candidates?: EvidenceCandidate[]; now?: Date } = {}): Promise<EvaluationReport> {
  const now = opts.now ?? new Date();
  const { data: m, error } = await admin.from("missions").select("*").eq("id", missionId).single();
  if (error || !m) throw new Error("mission not found");
  const mission = m as MissionRowLite;
  if (!["reflected", "transferred"].includes(mission.status)) throw new Error("mission must be reflected");
  const template = await loadTemplate(admin, mission.template_id, mission.template_version);
  if (!template) throw new Error("template not found");
  const { data: profile } = await admin.from("profiles").select("id, incentive_stage, timezone").eq("id", mission.profile_id).single();
  const primary = primaryCapability(template) as CapabilityId;
  const contextTag = mission.context_tag ?? (template.training_level === "simulated" ? "in_app" : "other");

  // الأدلة السابقة (لقاعدة G3 وللدرجات)
  const { data: priorRows } = await admin.from("evidence_events").select("capability_id, context_tag, value, weight, created_at, mission_id").eq("profile_id", mission.profile_id);
  const prior = (priorRows ?? []) as Array<{ capability_id: string; context_tag: string; value: number; weight: number; created_at: string; mission_id: string | null }>;
  const priorOther = prior.filter((e) => e.mission_id !== mission.id);

  const evaluation = evaluateMission({
    template,
    mission: {
      id: mission.id, status: "reflected", gate1: Boolean(mission.gate1), support_level: mission.support_level, strategy_chosen: mission.strategy_chosen, custom_strategy: mission.custom_strategy,
      custom_strategy_fit: opts.customStrategyFit ?? null, prediction: mission.prediction, actual_duration_min: mission.actual_duration_min, hints_used: mission.hints_used,
      distraction_log: mission.distraction_log ?? [], interrupted: (mission.interruption_reasons?.length ?? 0) > 0, context_tag: contextTag, evidence_candidates: opts.candidates ?? [],
    },
    hasPriorEvidenceInContext: (cap, ctx) => priorOther.some((e) => e.capability_id === cap && e.context_tag === ctx),
  });

  // 1) الأدلة (append-only، القيد الفريد يمنع التكرار)
  if (evaluation.events.length) {
    const { error: e1 } = await admin.from("evidence_events").upsert(
      evaluation.events.map((e) => ({ profile_id: mission.profile_id, mission_id: mission.id, capability_id: e.capability_id, rule_id: e.rule_id, source: e.source, type: e.type, value: e.value, rule_weight: e.rule_weight, weight: e.weight, context_tag: e.context_tag, support_level: e.support_level, config_version: e.config_version })),
      { onConflict: "mission_id,capability_id,type", ignoreDuplicates: true },
    );
    if (e1) throw e1;
  }
  // 2) البوابة الثانية على المهمة
  if (mission.gate2 !== evaluation.gate2) {
    const { error: e2 } = await admin.from("missions").update({ gate2: evaluation.gate2, gate2_score: evaluation.gate2_score, context_tag: contextTag }).eq("id", mission.id);
    if (e2) throw e2;
  }
  // 3) حالات القدرات والدرجات
  const { data: statesRows } = await admin.from("capability_states").select("*").eq("profile_id", mission.profile_id);
  const states = new Map(((statesRows ?? []) as Array<Record<string, unknown>>).map((s) => [s.capability_id as string, s]));
  const primaryState = states.get(primary);
  const primarySupport = (primaryState?.support_level as SupportLevel | undefined) ?? mission.support_level;

  // 4) XP (أ.8) مع السقف اليومي
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const { data: todayXp } = await admin.from("xp_events").select("amount").eq("profile_id", mission.profile_id).gte("created_at", dayStart.toISOString());
  const already = ((todayXp ?? []) as Array<{ amount: number }>).reduce((s, x) => s + x.amount, 0);
  const awards = applyDailyCap(missionXp({ gate1: Boolean(mission.gate1), gate2: evaluation.gate2, difficulty: mission.difficulty, trainingLevel: template.training_level, incentiveStage: (profile?.incentive_stage as number) ?? 1, primaryCapabilitySupport: primarySupport, isMasteryCheck: mission.is_mastery_check }), already);
  let xpTotal = 0;
  if (awards.length) {
    const { error: e3 } = await admin.from("xp_events").upsert(awards.map((a) => ({ profile_id: mission.profile_id, amount: a.amount, reason: a.reason, source_id: mission.id })), { onConflict: "reason,source_id", ignoreDuplicates: true });
    if (e3) throw e3;
    xpTotal = awards.reduce((s, a) => s + a.amount, 0);
  }

  // 5) تاريخ مهام القدرات (للدعم والتدريب)
  const { data: histRows } = await admin.from("missions").select("id, template_id, template_version, gate1, gate2, hints_used, status, is_mastery_check, created_at").eq("profile_id", mission.profile_id).in("status", ["reflected", "transferred"]).order("created_at", { ascending: false });
  const hist = (histRows ?? []) as Array<{ id: string; template_id: string; template_version: number; gate1: boolean | null; gate2: string | null; hints_used: number; status: string; is_mastery_check: boolean; created_at: string }>;
  const tplCache = new Map<string, MissionTemplate | null>();
  const tplOf = async (id: string, v: number) => { const k = `${id}@${v}`; if (!tplCache.has(k)) tplCache.set(k, await loadTemplate(admin, id, v)); return tplCache.get(k)!; };
  const { data: trRows } = await admin.from("transfer_reports").select("capability_id, worked, context_tag").eq("profile_id", mission.profile_id);
  const transfers = (trRows ?? []) as Array<{ capability_id: string; worked: boolean; context_tag: string }>;

  const allEvents = [...priorOther, ...evaluation.events.map((e) => ({ capability_id: e.capability_id, context_tag: e.context_tag, value: e.value, weight: e.weight, created_at: now.toISOString(), mission_id: mission.id }))];
  const supportChanges: string[] = [], trainingChanges: string[] = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const today = now.toISOString().slice(0, 10);

  for (const cap of CAPABILITY_IDS) {
    const st = states.get(cap);
    if (!st) continue;
    const score = computeCapabilityScore(allEvents.filter((e) => e.capability_id === cap), now);
    let supportLevel = st.support_level as SupportLevel;
    let trainingLevel = st.training_level as TrainingLevel;
    let mastered = st.mastered as boolean;
    let changedCount = st.support_changed_at_mission_count as number;
    let nextCheck = st.next_mastery_check_at as string | null;

    // مهام هذه القدرة
    const forSupport: CapMissionSummary[] = [], forTraining: CapMissionSummary[] = [];
    for (const h of hist) {
      const t = await tplOf(h.template_id, h.template_version);
      if (!t) continue;
      const w = (t.capability_weights as Record<string, number>)[cap] ?? 0;
      const summary: CapMissionSummary = { gate2: (h.gate2 as CapMissionSummary["gate2"]) ?? null, abandoned: h.gate1 === false, hints_used: h.hints_used, training_level: t.training_level, is_mastery_check: h.is_mastery_check };
      if (w >= supportCfg.evaluate_when_capability_weight_at_least) forSupport.push(summary);
      if (primaryCapability(t) === cap) forTraining.push(summary);
    }
    const capWeight = (template.capability_weights as Record<string, number>)[cap] ?? 0;
    const isThisMissionsCap = capWeight >= supportCfg.evaluate_when_capability_weight_at_least;

    if (mission.is_mastery_check && primary === cap && mastered) {
      const r = applyMasteryCheck(evaluation.gate2, supportLevel);
      if (!r.mastered) { trainingChanges.push(`${cap}:mastery_check_failed`); if (r.support_level !== supportLevel) supportChanges.push(`${cap}:${supportLevel}->${r.support_level}`); }
      mastered = r.mastered; trainingLevel = r.training_level; supportLevel = r.support_level;
      nextCheck = mastered ? nextMasteryCheckDate(now, mission.profile_id + cap + today) : null;
    } else if (isThisMissionsCap) {
      const d = decideSupport(supportLevel, forSupport, forSupport.length - changedCount, score.confidence);
      if (d.change !== "none") { supportChanges.push(`${cap}:${supportLevel}->${d.level}`); supportLevel = d.level; changedCount = forSupport.length; }
    }
    if (!mission.is_mastery_check && primary === cap) {
      const t = decideTraining({ current: trainingLevel, mastered, missions: forTraining, supportLevel, score: score.score, confidence: score.confidence, transferReports: transfers.filter((r) => r.capability_id === cap) });
      if (t.change) { trainingChanges.push(`${cap}:${trainingLevel}->${t.mastered ? "mastered" : t.level}`); trainingLevel = t.level; mastered = t.mastered; if (t.mastered) nextCheck = nextMasteryCheckDate(now, mission.profile_id + cap + today); }
    }
    await admin.from("capability_states").update({ support_level: supportLevel, support_changed_at_mission_count: changedCount, training_level: trainingLevel, mastered, next_mastery_check_at: nextCheck, updated_at: now.toISOString() }).eq("profile_id", mission.profile_id).eq("capability_id", cap);
    snapshots.push({ profile_id: mission.profile_id, capability_id: cap, date: today, score: score.score, confidence: score.confidence, training_level: trainingLevel, support_level: supportLevel, phrase_key: `${scoreBand(score.score)}:${confidenceBand(score.confidence)}`, config_version: CONFIG_VERSION });
  }
  const { error: e5 } = await admin.from("capability_snapshots").upsert(snapshots, { onConflict: "profile_id,capability_id,date" });
  if (e5) throw e5;

  return { mission_id: mission.id, gate2: evaluation.gate2, gate2_score: evaluation.gate2_score, events: evaluation.events.length, xp: xpTotal, support_changes: supportChanges, training_changes: trainingChanges };
}

/** MAP-5: إعادة حساب اللقطات كاملة من evidence_events بالإعدادات الحالية (حتمي). الأوزان تُشتق من source × support_level × rule_weight. */
export async function recomputeSnapshots(admin: SupabaseClient, profileId: string, now = new Date()): Promise<Array<Record<string, unknown>>> {
  const { evidenceWeight } = await import("./rules");
  const { data: rows } = await admin.from("evidence_events").select("capability_id, source, support_level, rule_weight, value, context_tag, created_at").eq("profile_id", profileId);
  const events = ((rows ?? []) as Array<{ capability_id: string; source: "auto" | "ai" | "self" | "guardian" | "companion"; support_level: SupportLevel; rule_weight: number; value: number; context_tag: string; created_at: string }>)
    .map((e) => ({ ...e, value: Number(e.value), weight: evidenceWeight(e.source, e.support_level, Number(e.rule_weight)) }));
  const { data: statesRows } = await admin.from("capability_states").select("*").eq("profile_id", profileId);
  const states = new Map(((statesRows ?? []) as Array<Record<string, unknown>>).map((s) => [s.capability_id as string, s]));
  const today = now.toISOString().slice(0, 10);
  const snapshots = CAPABILITY_IDS.map((cap) => {
    const s = computeCapabilityScore(events.filter((e) => e.capability_id === cap), now);
    const st = states.get(cap);
    return { profile_id: profileId, capability_id: cap, date: today, score: s.score, confidence: s.confidence, training_level: (st?.training_level as string) ?? "simulated", support_level: (st?.support_level as string) ?? "L1_hint", phrase_key: `${scoreBand(s.score)}:${confidenceBand(s.confidence)}`, config_version: CONFIG_VERSION };
  });
  const { error } = await admin.from("capability_snapshots").upsert(snapshots, { onConflict: "profile_id,capability_id,date" });
  if (error) throw error;
  return snapshots;
}
