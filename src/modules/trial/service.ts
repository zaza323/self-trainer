import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trial, CONFIG_VERSION, type AgeMode, type SupportLevel } from "@/shared/config";
import { effective } from "@/modules/settings";
import { loadActiveTemplates } from "@/modules/library";
import { computeCohortMetrics, weekOf, type ParticipantData, type CohortMetrics } from "./metrics";
import safetyResources from "@content/safety_resources.json";

export type CohortRow = { id: string; name: string; starts_at: string; weeks: number; enabled_age_modes: AgeMode[]; max_users: number; status: string };

/** يجمع بيانات مشارك واحد للمقاييس (بصلاحيات الخدمة؛ لا نصوص). */
export async function gatherParticipant(admin: SupabaseClient, p: { profile_id: string; age_mode_at_join: AgeMode; joined_at: string }, cohort: CohortRow, now: Date): Promise<ParticipantData> {
  const since = cohort.starts_at, until = now.toISOString();
  const templates = await loadActiveTemplates(admin);
  const real = new Set(templates.filter((t) => t.training_level !== "simulated").map((t) => t.id));
  const [{ data: ms }, { data: tr }, { data: snaps }, { data: states }, { data: ev }, { data: trans }, { data: sug }, { data: xp }, { data: rew }, focus] = await Promise.all([
    admin.from("missions").select("id, template_id, gate1, gate2, completed_at").eq("profile_id", p.profile_id).in("status", ["reflected", "transferred"]).gte("completed_at", since).lte("completed_at", until),
    admin.from("transfer_reports").select("mission_id").eq("profile_id", p.profile_id),
    admin.from("capability_snapshots").select("capability_id, score, date").eq("profile_id", p.profile_id).gte("date", since.slice(0, 10)).order("date", { ascending: true }),
    admin.from("capability_states").select("capability_id, support_level").eq("profile_id", p.profile_id),
    admin.from("evidence_events").select("type, value, context_tag, created_at").eq("profile_id", p.profile_id).gte("created_at", since),
    admin.from("missions").select("id").eq("profile_id", p.profile_id),
    admin.from("adaptation_suggestions").select("decision").eq("profile_id", p.profile_id).in("decision", ["accepted", "rejected", "expired"]),
    admin.from("xp_events").select("amount, created_at").eq("profile_id", p.profile_id).gte("created_at", since),
    admin.from("rewards").select("id").eq("profile_id", p.profile_id),
    effective<string[]>(admin, p.profile_id, "focus_capabilities"),
  ]);
  const allMissionIds = ((trans ?? []) as Array<{ id: string }>).map((m) => m.id);
  const { data: transRows } = allMissionIds.length ? await admin.from("mission_transitions").select("at").in("mission_id", allMissionIds).gte("at", since).limit(5000) : { data: [] };
  const rewardIds = ((rew ?? []) as Array<{ id: string }>).map((r) => r.id);
  const { data: deliveries } = rewardIds.length ? await admin.from("reward_events").select("at").in("reward_id", rewardIds).eq("to_status", "delivered") : { data: [] };
  const transferred = new Set(((tr ?? []) as Array<{ mission_id: string | null }>).map((t) => t.mission_id));
  const missions = ((ms ?? []) as Array<{ id: string; template_id: string; gate1: boolean | null; gate2: ParticipantData["missions"][number]["gate2"]; completed_at: string }>).map((m) => ({ completed_at: m.completed_at, gate1: m.gate1, gate2: m.gate2, has_transfer: transferred.has(m.id), is_real: real.has(m.template_id) }));
  const scoresWeek: ParticipantData["scoresWeek"] = {};
  for (const s of (snaps ?? []) as Array<{ capability_id: string; score: number; date: string }>) { const w = weekOf(p.joined_at, s.date); (scoresWeek[w] ??= {})[s.capability_id] = Number(s.score); }
  // مستوى الدعم في البداية: أول لقطة لكل قدرة؛ النهاية: الحالة الحالية
  const { data: firstSnaps } = await admin.from("capability_snapshots").select("capability_id, support_level, date").eq("profile_id", p.profile_id).gte("date", since.slice(0, 10)).order("date", { ascending: true });
  const supportStart: ParticipantData["supportStart"] = {};
  for (const s of (firstSnaps ?? []) as Array<{ capability_id: string; support_level: SupportLevel }>) if (!supportStart[s.capability_id]) supportStart[s.capability_id] = s.support_level;
  const supportEnd: ParticipantData["supportEnd"] = Object.fromEntries(((states ?? []) as Array<{ capability_id: string; support_level: SupportLevel }>).map((s) => [s.capability_id, s.support_level]));
  const helpByWeek = new Map<number, number[]>(); const novel: number[] = [], usual: number[] = [];
  for (const e of (ev ?? []) as Array<{ type: string; value: number; context_tag: string; created_at: string }>) {
    if (e.type === "help_needed") { const w = weekOf(p.joined_at, e.created_at); helpByWeek.set(w, [...(helpByWeek.get(w) ?? []), Number(e.value)]); }
    if (e.type === "novel_context") novel.push(Number(e.value)); else if (e.type !== "help_needed") usual.push(Number(e.value));
  }
  const helpNeededWeek: ParticipantData["helpNeededWeek"] = {};
  for (const [w, xs] of helpByWeek) helpNeededWeek[w] = xs.reduce((a, b) => a + b, 0) / xs.length;
  const xpWeek: Record<number, number> = {};
  for (const x of (xp ?? []) as Array<{ amount: number; created_at: string }>) { const w = weekOf(p.joined_at, x.created_at); xpWeek[w] = (xpWeek[w] ?? 0) + x.amount; }
  const sugs = (sug ?? []) as Array<{ decision: string }>;
  return {
    profile_id: p.profile_id, age_mode: p.age_mode_at_join, joined_at: p.joined_at, missions, scoresWeek, supportStart, supportEnd, helpNeededWeek,
    evidenceNovel: novel, evidenceUsual: usual,
    activeDays: [...new Set(((transRows ?? []) as Array<{ at: string }>).map((t) => t.at.slice(0, 10)))],
    suggestions: { decided: sugs.length, accepted: sugs.filter((s) => s.decision === "accepted").length },
    xpWeek, rewardDeliveries: ((deliveries ?? []) as Array<{ at: string }>).map((r) => ({ at: r.at })),
    focusCapabilities: focus.value ?? [],
  };
}

export async function activeCohort(db: SupabaseClient): Promise<CohortRow | null> {
  const { data } = await db.from("trial_cohorts").select("*").eq("status", "active").order("created_at", { ascending: false }).limit(1);
  return ((data ?? [])[0] as CohortRow | undefined) ?? null;
}

/** يحسب مقاييس الدفعة الآن ويحفظ لقطة الأسبوع الحالي (idempotent لكل أسبوع). */
export async function snapshotCohort(admin: SupabaseClient, cohort: CohortRow, now = new Date()): Promise<CohortMetrics & { week: number }> {
  const { data: parts } = await admin.from("trial_participants").select("profile_id, age_mode_at_join, joined_at").eq("cohort_id", cohort.id);
  const ps: ParticipantData[] = [];
  for (const p of (parts ?? []) as Array<{ profile_id: string; age_mode_at_join: AgeMode; joined_at: string }>) ps.push(await gatherParticipant(admin, p, cohort, now));
  const m = computeCohortMetrics(ps, now);
  const week = Math.max(1, weekOf(cohort.starts_at, now.toISOString()));
  await admin.from("trial_metric_snapshots").upsert({ cohort_id: cohort.id, week, metrics: m.metrics, warnings: m.warnings, participants: m.participants, config_version: CONFIG_VERSION, computed_at: now.toISOString() }, { onConflict: "cohort_id,week" });
  if (week > cohort.weeks) await admin.from("trial_cohorts").update({ status: "finished" }).eq("id", cohort.id);
  return { ...m, week };
}

/** الدورة: لقطة كل snapshot_every_days للدفعة النشطة. */
export async function tickTrial(admin: SupabaseClient, now = new Date()): Promise<{ snapshot: boolean }> {
  const c = await activeCohort(admin);
  if (!c) return { snapshot: false };
  const { data: last } = await admin.from("trial_metric_snapshots").select("computed_at").eq("cohort_id", c.id).order("computed_at", { ascending: false }).limit(1);
  const lastAt = ((last ?? [])[0] as { computed_at?: string } | undefined)?.computed_at;
  if (lastAt && now.getTime() - Date.parse(lastAt) < trial.cohort.snapshot_every_days * 86400000) return { snapshot: false };
  await snapshotCohort(admin, c, now);
  return { snapshot: true };
}

export type ReadinessItem = { key: string; ok: boolean; detail?: string };
/** جاهزية الإطلاق: البيئة، موارد الأمان المتحقق منها، عدد القوالب النشطة. */
export async function readiness(db: SupabaseClient, env: NodeJS.ProcessEnv = process.env): Promise<ReadinessItem[]> {
  const items: ReadinessItem[] = trial.readiness.required_env.map((k) => ({ key: `env:${k}`, ok: Boolean(env[k] && !String(env[k]).includes("YOUR-")) }));
  for (const k of trial.readiness.optional_env) items.push({ key: `env:${k} (اختياري)`, ok: true, detail: env[k] ? "مضبوط" : "غير مضبوط" });
  if (trial.readiness.require_safety_resources_verified) {
    const countries = Object.entries(safetyResources).filter(([k]) => !k.startsWith("_") && k !== "unverified_notice") as Array<[string, { verified?: boolean }]>;
    const verified = countries.filter(([, v]) => v && typeof v === "object" && v.verified === true).length;
    items.push({ key: "safety_resources_verified", ok: countries.length > 0 && verified === countries.length, detail: `${verified}/${countries.length}` });
  }
  const { data: tpls } = await db.from("mission_templates").select("id").eq("status", "active");
  const n = (tpls ?? []).length;
  items.push({ key: "active_templates", ok: n >= trial.readiness.min_active_templates, detail: String(n) });
  return items;
}
