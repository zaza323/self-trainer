import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { customization, CAPABILITY_IDS, type AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { loadActiveTemplates, loadTemplate, textByMode } from "@/modules/library";
import type { ModelCaller } from "@/modules/companion";
import { adviseAdaptation, draftTemplate } from "@/modules/companion";
import { computeStrategyOutcomes, type OutcomeMission, type StrategyOutcomeRow } from "./strategy-outcomes";
import { templateMetricsFrom, type MetricMission } from "./template-metrics";
import { filterSuggestions, type RawSuggestion, type Suggestion } from "./advisor";

type Profile = { id: string; user_id: string; age_mode: AgeMode | null; display_name: string; kind: string; timezone: string };

/** ADAPT-3: إعادة حساب ذاكرة الاستراتيجيات لمتدرب من مهامه المقيَّمة (تُستدعى بعد كل تأمل). */
export async function recomputeStrategyOutcomes(admin: SupabaseClient, profileId: string): Promise<StrategyOutcomeRow[]> {
  const [{ data: ms }, { data: tpls }] = await Promise.all([
    admin.from("missions").select("template_id, strategy_chosen, custom_strategy, custom_strategy_label, gate2, completed_at").eq("profile_id", profileId).in("status", ["reflected", "transferred"]),
    admin.from("mission_templates").select("id, version, mechanic_id"),
  ]);
  const mech = new Map(((tpls ?? []) as Array<{ id: string; mechanic_id: string }>).map((t) => [t.id, t.mechanic_id]));
  const rows = computeStrategyOutcomes(((ms ?? []) as Array<Omit<OutcomeMission, "mechanic"> & { template_id: string }>).map((m) => ({ ...m, mechanic: mech.get(m.template_id) ?? "unknown" })).filter((m) => m.mechanic !== "unknown"));
  if (rows.length) await admin.from("strategy_outcomes").upsert(rows.map((r) => ({ profile_id: profileId, ...r, updated_at: new Date().toISOString() })), { onConflict: "profile_id,mechanic_id,strategy_key" });
  return rows;
}

export async function loadStrategyOutcomes(db: SupabaseClient, profileId: string): Promise<StrategyOutcomeRow[]> {
  const { data } = await db.from("strategy_outcomes").select("mechanic_id, strategy_key, strategy_label, uses, shown_count, partial_count, last_used_at").eq("profile_id", profileId);
  return (data ?? []) as StrategyOutcomeRow[];
}

/** ADAPT-6: مقاييس فعالية كل نسخة قالب وتعليم الضعيف للمشرف (سجل تدقيق عند أول تعليم). */
export async function computeTemplateMetrics(admin: SupabaseClient, now = new Date()): Promise<{ computed: number; flagged: string[] }> {
  const [{ data: ms }, { data: tr }, { data: prev }] = await Promise.all([
    admin.from("missions").select("id, template_id, template_version, status, gate2, prediction, actual_duration_min").in("status", ["completed", "abandoned", "reflected", "transferred"]),
    admin.from("transfer_reports").select("mission_id"),
    admin.from("template_metrics").select("template_id, template_version, flagged"),
  ]);
  const transferred = new Set(((tr ?? []) as Array<{ mission_id: string | null }>).map((t) => t.mission_id));
  const metrics = templateMetricsFrom(((ms ?? []) as Array<Omit<MetricMission, "transferred"> & { id: string }>).map((m) => ({ ...m, transferred: transferred.has(m.id) })));
  const wasFlagged = new Set(((prev ?? []) as Array<{ template_id: string; template_version: number; flagged: boolean }>).filter((p) => p.flagged).map((p) => `${p.template_id}:${p.template_version}`));
  if (metrics.length) await admin.from("template_metrics").upsert(metrics.map((m) => ({ ...m, computed_at: now.toISOString() })), { onConflict: "template_id,template_version" });
  const flagged: string[] = [];
  for (const m of metrics) {
    const key = `${m.template_id}:${m.template_version}`;
    if (m.flagged) flagged.push(key);
    if (m.flagged && !wasFlagged.has(key)) await admin.from("audit_log").insert({ actor_id: null, action: "template_flagged", target: key, meta: { reasons: m.flag_reasons, missions_n: m.missions_n, shown_rate: m.shown_rate, abandon_rate: m.abandon_rate } });
  }
  return { computed: metrics.length, flagged };
}

/** ADAPT-7: مسودة محسّنة لكل قالب مُعلَّم ليس له مسودة معلقة — إلى طابور المشرف فقط. */
export async function draftFlaggedTemplates(admin: SupabaseClient, caller: ModelCaller, now = new Date()): Promise<number> {
  if (!caller.enabled) return 0;
  const { data: flagged } = await admin.from("template_metrics").select("*").eq("flagged", true);
  let created = 0;
  for (const m of (flagged ?? []) as Array<{ template_id: string; template_version: number } & Record<string, unknown>>) {
    const { data: pending } = await admin.from("template_draft_reviews").select("template_id").eq("template_id", m.template_id).eq("status", "pending").limit(1);
    if (pending?.length) continue;
    const t = await loadTemplate(admin, m.template_id, m.template_version);
    if (!t || t.status !== "active") continue;
    const d = await draftTemplate({ db: admin, caller, template: t, metrics: m, now });
    if (!d) continue;
    const { data: versions } = await admin.from("mission_templates").select("version").eq("id", m.template_id).order("version", { ascending: false }).limit(1);
    const version = (((versions ?? [])[0] as { version: number } | undefined)?.version ?? t.version) + 1;
    const dt = d.draft;
    const { error } = await admin.from("mission_templates").insert({
      id: dt.id, version, mechanic_id: dt.mechanic, training_level: dt.training_level, difficulty: dt.difficulty, age_modes: dt.age_modes, title_by_mode: dt.title, situation_by_mode: dt.situation,
      variable_defaults: dt.variable_defaults, strategies: dt.strategies, prediction_prompt: dt.prediction_prompt ?? null, reflection_prompts: dt.reflection_prompts, hints_by_level: dt.hints_by_level,
      evidence_rules: dt.evidence_rules, completion_check: dt.completion_check, checklist: dt.checklist ?? null, min_duration: dt.min_duration, max_duration: dt.max_duration, distraction_config: dt.distraction_config ?? null,
      status: "draft", origin: "ai_draft",
    });
    if (error) continue;
    await admin.from("template_capabilities").insert(Object.entries(dt.capability_weights).map(([capability_id, weight]) => ({ template_id: dt.id, template_version: version, capability_id, weight })));
    await admin.from("template_draft_reviews").insert({ template_id: dt.id, template_version: version, source_version: m.template_version, metrics: m, rationale: d.rationale });
    created++;
  }
  return created;
}

/** إحصاءات الأسبوعين لمستشار التكيّف (7.2): أدلة حسب القدرة، المهام حسب ساعة اليوم ونتيجتها، التخلي، الدعم. */
export async function advisorStats(admin: SupabaseClient, profileId: string, now = new Date()) {
  const since = new Date(now.getTime() - customization.adaptation.lookback_days * 86400000).toISOString();
  const [{ data: ev }, { data: ms }, { data: st }, tpls] = await Promise.all([
    admin.from("evidence_events").select("capability_id, value, weight, context_tag").eq("profile_id", profileId).gte("created_at", since),
    admin.from("missions").select("template_id, status, gate1, gate2, started_at, completed_at, hints_used, suggested_for, dismissed").eq("profile_id", profileId).gte("created_at", since),
    admin.from("capability_states").select("capability_id, support_level, training_level, mastered").eq("profile_id", profileId),
    loadActiveTemplates(admin),
  ]);
  const mech = new Map(tpls.map((t) => [t.id, t.mechanic]));
  const byCap: Record<string, { n: number; mean: number }> = {};
  for (const e of (ev ?? []) as Array<{ capability_id: string; value: number; weight: number }>) {
    const b = byCap[e.capability_id] ?? { n: 0, mean: 0 };
    b.mean = (b.mean * b.n + Number(e.value)) / (b.n + 1); b.n++; byCap[e.capability_id] = b;
  }
  const byHour: Record<string, { n: number; shown: number; abandoned: number }> = {};
  const byMechanic: Record<string, { n: number; shown: number }> = {};
  let dismissed = 0, abandoned = 0, total = 0;
  for (const m of (ms ?? []) as Array<{ template_id: string; status: string; gate2: string | null; started_at: string | null; dismissed: boolean }>) {
    if (m.dismissed) { dismissed++; continue; }
    total++;
    if (m.status === "abandoned") abandoned++;
    if (m.started_at) { const h = String(new Date(m.started_at).getUTCHours()); const b = byHour[h] ?? { n: 0, shown: 0, abandoned: 0 }; b.n++; if (m.gate2 === "shown") b.shown++; if (m.status === "abandoned") b.abandoned++; byHour[h] = b; }
    const mk = mech.get(m.template_id) ?? "unknown"; const bm = byMechanic[mk] ?? { n: 0, shown: 0 }; bm.n++; if (m.gate2 === "shown") bm.shown++; byMechanic[mk] = bm;
  }
  return { evidence_by_capability: byCap, missions_by_start_hour_utc: byHour, missions_by_mechanic: byMechanic, missions_total: total, dismissed, abandoned, capability_states: st ?? [] };
}

async function currentSettingsFor(admin: SupabaseClient, profileId: string): Promise<Record<string, unknown>> {
  const keys = ["available_windows", "focus_capabilities", "daily_mission_count"] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (await effective(admin, profileId, k)).value;
  return out;
}

/**
 * ADAPT-4/5: تشغيل المستشار لمتدرب: يجمع الإحصاءات، يستدعي النموذج، يرشّح (الأنواع، القص، لا تكرار المرفوض 30 يومًا)، يحفظ، ويُخطر صاحب القرار.
 * يقبل `rawOverride` لاختبار المسار بلا نموذج.
 */
export async function runAdvisorForProfile(admin: SupabaseClient, caller: ModelCaller, p: Profile, now = new Date(), rawOverride?: RawSuggestion[]): Promise<{ created: Suggestion[]; rejected: number }> {
  if (!p.age_mode) return { created: [], rejected: 0 };
  const cfg = customization.adaptation;
  const since = new Date(now.getTime() - cfg.reject_cooldown_days * 86400000).toISOString();
  const [{ data: rejectedRows }, { data: pendingRows }, { data: links }] = await Promise.all([
    admin.from("adaptation_suggestions").select("dedupe_key").eq("profile_id", p.id).eq("decision", "rejected").gte("decided_at", since),
    admin.from("adaptation_suggestions").select("dedupe_key").eq("profile_id", p.id).is("decision", null),
    admin.from("guardian_links").select("guardian_id, permissions, is_creator").eq("player_id", p.id).eq("status", "active"),
  ]);
  const currentValues = await currentSettingsFor(admin, p.id);
  const ctx = { mode: p.age_mode, currentValues, rejectedKeys: new Set(((rejectedRows ?? []) as Array<{ dedupe_key: string }>).map((r) => r.dedupe_key)), pendingKeys: new Set(((pendingRows ?? []) as Array<{ dedupe_key: string }>).map((r) => r.dedupe_key)), hasGuardian: (links ?? []).length > 0 };
  let raws: RawSuggestion[];
  if (rawOverride) raws = rawOverride;
  else {
    const stats = await advisorStats(admin, p.id, now);
    raws = (await adviseAdaptation({ db: admin, caller, profileId: p.id, mode: p.age_mode, stats, currentSettings: currentValues, now })).suggestions.map((s) => ({ ...s, setting_key: s.setting_key ?? null }));
  }
  const { accepted, rejected } = filterSuggestions(raws, ctx);
  const expires = new Date(now.getTime() + cfg.expire_after_days * 86400000).toISOString();
  if (accepted.length) {
    await admin.from("adaptation_suggestions").insert(accepted.map((s) => ({ profile_id: p.id, type: s.type, setting_key: s.setting_key, proposed_value: s.proposed_value, reason_short: s.reason_short, expected_effect: s.expected_effect, audience: s.audience, dedupe_key: s.dedupe_key, expires_at: expires, created_at: now.toISOString() })));
    // إشعار صاحب القرار (NOTIF-2): المربون في child/للجمهور guardian، وإلا المتدرب
    const guardianIds = ((links ?? []) as Array<{ guardian_id: string; permissions: Record<string, boolean>; is_creator: boolean }>).filter((l) => l.is_creator || l.permissions[cfg.approver_permission]).map((l) => l.guardian_id);
    const toGuardians = p.age_mode === "child" || accepted.every((s) => s.audience === "guardian");
    const notifs = toGuardians ? guardianIds.map((g) => ({ profile_id: p.id, type: "adaptation_suggestion", payload: { guardian_id: g, count: accepted.length } })) : [{ profile_id: p.id, type: "adaptation_suggestion", payload: { count: accepted.length } }];
    if (notifs.length) await admin.from("notifications").insert(notifs);
  }
  await admin.from("adaptation_runs").upsert({ profile_id: p.id, last_run_at: now.toISOString(), last_suggestions: accepted.length }, { onConflict: "profile_id" });
  return { created: accepted, rejected: rejected.length };
}

/** انتهاء صلاحية الاقتراحات المعلقة القديمة. */
export async function expireSuggestions(admin: SupabaseClient, now = new Date()): Promise<number> {
  const { data } = await admin.from("adaptation_suggestions").update({ decision: "expired", decided_at: now.toISOString() }).is("decision", null).lt("expires_at", now.toISOString()).select("id");
  return (data as unknown[] | null)?.length ?? 0;
}

/** الدورة الأسبوعية/اليومية (تُستدعى من /api/cron/tick): المستشار لمن حان دوره، انتهاء الصلاحية، المقاييس، المسودات. */
export async function runAdaptationTick(admin: SupabaseClient, caller: ModelCaller, now = new Date()) {
  const cfg = customization.adaptation;
  const expired = await expireSuggestions(admin, now);
  const [{ data: profs }, { data: runs }] = await Promise.all([
    admin.from("profiles").select("id, user_id, age_mode, display_name, kind, timezone").eq("kind", "player"),
    admin.from("adaptation_runs").select("profile_id, last_run_at"),
  ]);
  const last = new Map(((runs ?? []) as Array<{ profile_id: string; last_run_at: string }>).map((r) => [r.profile_id, Date.parse(r.last_run_at)]));
  let advised = 0, created = 0;
  for (const p of (profs ?? []) as Profile[]) {
    const prev = last.get(p.id);
    if (prev && now.getTime() - prev < cfg.run_every_days * 86400000) continue;
    const breakMode = (await effective<boolean>(admin, p.id, "break_mode")).value;
    if (breakMode) continue;
    const r = await runAdvisorForProfile(admin, caller, p, now);
    advised++; created += r.created.length;
  }
  const { data: lastMetric } = await admin.from("template_metrics").select("computed_at").order("computed_at", { ascending: false }).limit(1);
  const lastComputed = ((lastMetric ?? [])[0] as { computed_at?: string } | undefined)?.computed_at;
  let metrics: Awaited<ReturnType<typeof computeTemplateMetrics>> | null = null, drafts = 0;
  if (!lastComputed || now.getTime() - Date.parse(lastComputed) >= customization.template_metrics.recompute_every_days * 86400000) {
    metrics = await computeTemplateMetrics(admin, now);
    drafts = await draftFlaggedTemplates(admin, caller, now);
  }
  return { expired, advised, created, metrics, drafts };
}

/** تسمية الاستراتيجية للعرض: نص استراتيجية القالب أو التسمية الموحدة. */
export function strategyLabelFor(key: string, templateStrategies: Array<{ id: string; text: unknown }>, mode: AgeMode, rows: StrategyOutcomeRow[]): string {
  if (key.startsWith("custom:")) return rows.find((r) => r.strategy_key === key)?.strategy_label ?? key.slice("custom:".length);
  const st = templateStrategies.find((s) => s.id === key);
  return st ? textByMode(st.text as Parameters<typeof textByMode>[0], mode) : key;
}

export const capabilityIds = CAPABILITY_IDS;
