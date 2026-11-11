import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { margins, type AgeMode, type SupportLevel } from "@/shared/config";
import { effective } from "@/modules/settings";
import { recordTrace } from "@/modules/trace/service";
import content from "@content/margins.ar.json";
import {
  systemDefault, missionSimilarity, plannerSimilarity, recommend, resolveMargin, reviewKey, reviewText, median, fill,
  type SubjectType, type Similarity, type Resolved, type HistoryMode, type MarginSource, type RuleLite, type MarginEventLite, type DefaultResult, type ReviewFinding,
} from "./rules";

type Db = SupabaseClient;
const DAY_MS = 86400000;
const DONE_MISSION = ["completed", "reflected", "transferred"];
const PLANNING = "planning";

export type SubjectCtx = {
  type: SubjectType; id: string; profileId: string; mode: AgeMode; title: string;
  sim: Similarity; supportLevel: SupportLevel; system: DefaultResult; userEstimate: number | null;
  task: { margin_min: number | null; margin_source: MarginSource | null; margin_set_by: string | null; margin_locked: boolean; margin_extra_min: number };
};

async function supportFor(db: Db, profileId: string, capability: string): Promise<SupportLevel> {
  const { data } = await db.from("capability_states").select("support_level").eq("profile_id", profileId).eq("capability_id", capability).maybeSingle();
  return ((data as { support_level?: SupportLevel } | null)?.support_level ?? "L1_hint") as SupportLevel;
}
async function modeOf(db: Db, profileId: string): Promise<AgeMode | null> {
  const { data } = await db.from("profiles").select("age_mode").eq("id", profileId).maybeSingle();
  return ((data as { age_mode?: AgeMode } | null)?.age_mode ?? null);
}

/** يجمع مدخلات القاعدة الافتراضية ومفاتيح التشابه لمهمة تدريبية أو مهمة مخطط. الأزمنة الفعلية من هذا المتدرب فقط. */
export async function subjectContext(db: Db, type: SubjectType, id: string, now: Date, freeGapMin: number | null = null): Promise<SubjectCtx | null> {
  const d = margins.default_rule, since = new Date(now.getTime() - d.history_actuals.lookback_days * DAY_MS).toISOString();
  if (type === "mission") {
    const { data: m } = await db.from("missions").select("id, profile_id, template_id, template_version, time_estimate, margin_min, margin_source, margin_set_by, margin_locked, margin_extra_min").eq("id", id).maybeSingle();
    if (!m) return null;
    const mode = await modeOf(db, m.profile_id as string);
    if (!mode) return null;
    const [{ data: tpl }, { data: caps }] = await Promise.all([
      db.from("mission_templates").select("mechanic_id, min_duration, max_duration, title_by_mode").eq("id", m.template_id).eq("version", m.template_version).maybeSingle(),
      db.from("template_capabilities").select("capability_id, weight").eq("template_id", m.template_id).eq("template_version", m.template_version).order("weight", { ascending: false }).limit(1),
    ]);
    const cap = ((caps ?? []) as Array<{ capability_id: string }>)[0]?.capability_id ?? PLANNING;
    const mech = (tpl as { mechanic_id?: string } | null)?.mechanic_id ?? "";
    const sim = missionSimilarity({ template_id: m.template_id as string, capability_id: cap, mechanic: mech });
    const { data: l1 } = await db.from("missions").select("actual_duration_min").eq("profile_id", m.profile_id).eq("template_id", m.template_id).in("status", DONE_MISSION).gte("completed_at", since).neq("id", id).not("actual_duration_min", "is", null);
    let actuals = ((l1 ?? []) as Array<{ actual_duration_min: number }>).map((r) => r.actual_duration_min);
    if (actuals.length < d.history_actuals.min_samples && mech) {
      const [{ data: sameMech }, { data: sameCap }] = await Promise.all([
        db.from("mission_templates").select("id").eq("mechanic_id", mech),
        db.from("template_capabilities").select("template_id, weight").eq("capability_id", cap),
      ]);
      const capIds = new Set(((sameCap ?? []) as Array<{ template_id: string }>).map((r) => r.template_id));
      const ids = [...new Set(((sameMech ?? []) as Array<{ id: string }>).map((r) => r.id).filter((x) => capIds.has(x)))];
      if (ids.length) {
        const { data: l2 } = await db.from("missions").select("actual_duration_min").eq("profile_id", m.profile_id).in("template_id", ids).in("status", DONE_MISSION).gte("completed_at", since).neq("id", id).not("actual_duration_min", "is", null);
        const more = ((l2 ?? []) as Array<{ actual_duration_min: number }>).map((r) => r.actual_duration_min);
        if (more.length >= d.history_actuals.min_samples) actuals = more;
      }
    }
    const supportLevel = await supportFor(db, m.profile_id as string, cap);
    const t = tpl as { min_duration?: number; max_duration?: number; title_by_mode?: Record<string, string> } | null;
    const system = systemDefault({ mode, supportLevel, actuals, userEstimate: (m.time_estimate as number | null) ?? null, templateRange: t?.min_duration && t.max_duration ? { min: t.min_duration, max: t.max_duration } : null, freeGapMin });
    return { type, id, profileId: m.profile_id as string, mode, title: t?.title_by_mode?.[mode] ?? "", sim, supportLevel, system, userEstimate: (m.time_estimate as number | null) ?? null,
      task: { margin_min: m.margin_min as number | null, margin_source: m.margin_source as MarginSource | null, margin_set_by: m.margin_set_by as string | null, margin_locked: Boolean(m.margin_locked), margin_extra_min: (m.margin_extra_min as number) ?? 0 } };
  }
  const { data: t } = await db.from("planner_tasks").select("id, profile_id, title, project_id, estimate_min, margin_min, margin_source, margin_set_by, margin_locked, margin_extra_min").eq("id", id).maybeSingle();
  if (!t) return null;
  const mode = await modeOf(db, t.profile_id as string);
  if (!mode) return null;
  const { data: tags } = await db.from("planner_task_tags").select("tag_id").eq("task_id", id);
  const sim = plannerSimilarity({ title: t.title as string, project_id: (t.project_id as string | null) ?? null, tag_ids: ((tags ?? []) as Array<{ tag_id: string }>).map((x) => x.tag_id) });
  const { data: done } = await db.from("planner_tasks").select("id, title, project_id, actual_min").eq("profile_id", t.profile_id).eq("status", "done").gte("completed_at", since).neq("id", id).not("actual_min", "is", null);
  const rows = (done ?? []) as Array<{ id: string; title: string; project_id: string | null; actual_min: number }>;
  let actuals = rows.filter((r) => plannerSimilarity({ title: r.title, project_id: null, tag_ids: [] }).l1 === sim.l1).map((r) => r.actual_min);
  if (actuals.length < d.history_actuals.min_samples && sim.l2 && rows.length) {
    const { data: tt } = await db.from("planner_task_tags").select("task_id, tag_id").in("task_id", rows.map((r) => r.id));
    const byTask = new Map<string, string[]>();
    for (const x of (tt ?? []) as Array<{ task_id: string; tag_id: string }>) byTask.set(x.task_id, [...(byTask.get(x.task_id) ?? []), x.tag_id]);
    const more = rows.filter((r) => plannerSimilarity({ title: r.title, project_id: r.project_id, tag_ids: byTask.get(r.id) ?? [] }).l2 === sim.l2).map((r) => r.actual_min);
    if (more.length >= d.history_actuals.min_samples) actuals = more;
  }
  const supportLevel = await supportFor(db, t.profile_id as string, PLANNING);
  const system = systemDefault({ mode, supportLevel, actuals, userEstimate: (t.estimate_min as number | null) ?? null, templateRange: null, freeGapMin });
  return { type, id, profileId: t.profile_id as string, mode, title: t.title as string, sim, supportLevel, system, userEstimate: (t.estimate_min as number | null) ?? null,
    task: { margin_min: t.margin_min as number | null, margin_source: t.margin_source as MarginSource | null, margin_set_by: t.margin_set_by as string | null, margin_locked: Boolean(t.margin_locked), margin_extra_min: (t.margin_extra_min as number) ?? 0 } };
}

type LinkRow = { id: string; guardian_id: string; relation: string; is_creator: boolean };
async function linksOf(db: Db, profileId: string): Promise<LinkRow[]> {
  const { data } = await db.from("guardian_links").select("id, guardian_id, relation, is_creator").eq("player_id", profileId).eq("status", "active");
  return (data ?? []) as LinkRow[];
}
export async function historyModeOf(db: Db, profileId: string): Promise<HistoryMode> {
  return ((await effective<string>(db, profileId, "margin_history_mode")).value ?? margins.history.default_mode) as HistoryMode;
}

export type MarginView = Resolved & { extra_min: number; locked: boolean; set_by_label: string | null; planning_support: SupportLevel; user_estimate: number | null; sim: Similarity };

/** ب.3: الهامش الفعلي لمهمة، مع مصدره واسم/صفة من ضبطه. يقرأ تعديلات وقواعد هذا المتدرب فقط. */
export async function resolveFor(db: Db, type: SubjectType, id: string, now: Date, opts: { viewerId?: string | null; freeGapMin?: number | null } = {}): Promise<{ ctx: SubjectCtx; view: MarginView } | null> {
  const ctx = await subjectContext(db, type, id, now, opts.freeGapMin ?? null);
  if (!ctx) return null;
  const since = new Date(now.getTime() - margins.history.lookback_days * DAY_MS).toISOString();
  const [links, { data: ruleRows }, { data: eventRows }, historyMode, planningSupport] = await Promise.all([
    linksOf(db, ctx.profileId),
    db.from("margin_rules").select("id, similarity_key, level, margin_min, set_by, guardian_link_id, updated_at").eq("profile_id", ctx.profileId).eq("subject_type", type).eq("active", true),
    db.from("margin_events").select("profile_id, similarity, set_min, created_at, guardian_link_id").eq("profile_id", ctx.profileId).eq("subject_type", type).gte("created_at", since).neq("subject_id", id),
    historyModeOf(db, ctx.profileId),
    supportFor(db, ctx.profileId, PLANNING),
  ]);
  const creator = links.find((l) => l.is_creator) ?? null;
  const rules: RuleLite[] = ((ruleRows ?? []) as Array<Omit<RuleLite, "is_creator">>).map((r) => ({ ...r, is_creator: Boolean(creator && r.guardian_link_id === creator.id) }));
  const recommendation = recommend((eventRows ?? []) as MarginEventLite[], { profileId: ctx.profileId, sim: ctx.sim, now, creatorLinkId: creator?.id ?? null, mode: ctx.mode });
  const r = resolveMargin({ mode: ctx.mode, sim: ctx.sim, task: ctx.task, rules, recommendation, historyMode, system: ctx.system });
  const setter = r.set_by ? links.find((l) => l.guardian_id === r.set_by) : null;
  const rel = content.relations as Record<string, string>;
  const set_by_label = r.source === "system" ? null : r.source === "history" ? content.from_history
    : r.source === "user" ? (opts.viewerId && r.set_by === opts.viewerId ? content.set_by_you : null)
    : fill(content.set_by, { name: setter ? rel[setter.relation] ?? rel.other! : rel.other! });
  return { ctx, view: { ...r, extra_min: ctx.task.margin_extra_min, locked: ctx.task.margin_locked, set_by_label, planning_support: planningSupport, user_estimate: ctx.userEstimate, sim: ctx.sim } };
}

/** RULES-7: كل حل للهامش يكتب أثر قرار (مرة لكل قرار مختلف على نفس المهمة). */
export async function traceResolved(admin: Db, ctx: SubjectCtx, view: Resolved, now: Date): Promise<boolean> {
  return recordTrace(admin, {
    profile_id: ctx.profileId, kind: "time_margin", subject_type: ctx.type, subject_id: ctx.id, rule: view.rule,
    decision: { margin_min: view.margin_min, source: view.source, set_by: view.set_by },
    inputs: { ...view.detail, system_default_min: view.system_default, basis: view.basis, support_level: ctx.supportLevel, mode: ctx.mode },
  }, now);
}

export type SetMarginInput = { actorId: string; type: SubjectType; id: string; minutes: number; applyScope: "this_task" | "all_similar"; reason?: string | null; lock?: boolean };
export type SetMarginResult = { ok: true; margin_min: number; source: MarginSource; stored_min: number; applied: boolean; event_id: string; rule_id: string | null } | { ok: false; error: string };

/** ب.8: الكتابة الوحيدة للهامش. الخادم يحسب الافتراضي ومفاتيح التشابه، والقاعدة (RPC لدور الخدمة) تتحقق وتقص وتكتب الحدث ثم تحدّث المهمة. */
export async function setTaskMargin(admin: Db, i: SetMarginInput, now: Date): Promise<SetMarginResult> {
  const ctx = await subjectContext(admin, i.type, i.id, now);
  if (!ctx) return { ok: false, error: "not_allowed" };
  const { data, error } = await admin.rpc("set_task_margin", {
    p_actor: i.actorId, p_subject_type: i.type, p_subject_id: i.id, p_set_min: Math.round(i.minutes), p_apply_scope: i.applyScope,
    p_reason: i.reason ?? null, p_system_default: ctx.system.value, p_similarity: ctx.sim, p_lock: Boolean(i.lock),
  });
  if (error) {
    const m = /not allowed: (\w+)/.exec(error.message);
    return { ok: false, error: m ? m[1]! : /not allowed|42501/.test(error.message) ? "not_allowed" : "invalid_input" };
  }
  const r = data as { margin_min: number; source: MarginSource; stored_min: number; applied: boolean; event_id: string; rule_id: string | null };
  return { ok: true, ...r };
}

export async function extendMargin(admin: Db, i: { actorId: string; type: SubjectType; id: string; minutes: number }): Promise<{ ok: true; extra_min: number } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("extend_task_margin", { p_actor: i.actorId, p_subject_type: i.type, p_subject_id: i.id, p_minutes: i.minutes });
  return error ? { ok: false, error: /not allowed/.test(error.message) ? "not_allowed" : "invalid_input" } : { ok: true, extra_min: data as number };
}

export async function updateRule(admin: Db, i: { actorId: string; ruleId: string; minutes?: number | null; active?: boolean | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.rpc("margin_rule_update", { p_actor: i.actorId, p_rule_id: i.ruleId, p_margin_min: i.minutes ?? null, p_active: i.active ?? null });
  return error ? { ok: false, error: /not allowed/.test(error.message) ? "not_allowed" : "invalid_input" } : { ok: true };
}

/**
 * ب.7: مراجعة أسبوعية بالقواعد (uses_ai = false). لكل مفتاح تشابه له هامش مضبوط (قاعدة فعالة أو تعديل على المهام)
 * وفيه ≥ min_completions إنجازات ضمن النافذة: ضيق/واسع ⇒ اقتراح margin_adjustment واحد على الأكثر لكل تشغيل، ينتظر الموافقة.
 * الرفض يُسكت المفتاح reject_cooldown_days.
 */
export async function runMarginReview(admin: Db, p: { id: string; age_mode: AgeMode }, now: Date): Promise<{ created: ReviewFinding[] }> {
  const r = margins.review, since = new Date(now.getTime() - r.lookback_days * DAY_MS).toISOString();
  const [{ data: missions }, { data: tasks }, { data: rules }, { data: rejected }, { data: pending }] = await Promise.all([
    admin.from("missions").select("id, template_id, template_version, actual_duration_min, margin_min, completed_at").eq("profile_id", p.id).in("status", DONE_MISSION).gte("completed_at", since).not("actual_duration_min", "is", null),
    admin.from("planner_tasks").select("id, title, project_id, actual_min, margin_min, completed_at").eq("profile_id", p.id).eq("status", "done").gte("completed_at", since).not("actual_min", "is", null),
    admin.from("margin_rules").select("subject_type, similarity_key, level, margin_min, updated_at").eq("profile_id", p.id).eq("active", true),
    admin.from("adaptation_suggestions").select("dedupe_key").eq("profile_id", p.id).eq("type", r.suggestion_type).eq("decision", "rejected").gte("decided_at", new Date(now.getTime() - r.reject_cooldown_days * DAY_MS).toISOString()),
    admin.from("adaptation_suggestions").select("dedupe_key").eq("profile_id", p.id).eq("type", r.suggestion_type).is("decision", null),
  ]);
  const blocked = new Set([...(rejected ?? []), ...(pending ?? [])].map((x) => (x as { dedupe_key: string }).dedupe_key));
  type Group = { subject_type: SubjectType; key: string; actuals: number[]; taskMargins: number[]; latest: string };
  const groups = new Map<string, Group>();
  const add = (subject_type: SubjectType, key: string | null, actual: number, margin: number | null, at: string) => {
    if (!key) return;
    const g = groups.get(`${subject_type}|${key}`) ?? { subject_type, key, actuals: [], taskMargins: [], latest: at };
    g.actuals.push(actual); if (margin) g.taskMargins.push(margin); if (at > g.latest) g.latest = at;
    groups.set(`${subject_type}|${key}`, g);
  };
  for (const m of (missions ?? []) as Array<{ template_id: string; actual_duration_min: number; margin_min: number | null; completed_at: string }>) add("mission", `tpl:${m.template_id}`, m.actual_duration_min, m.margin_min, m.completed_at);
  for (const t of (tasks ?? []) as Array<{ title: string; actual_min: number; margin_min: number | null; completed_at: string }>) add("planner_task", plannerSimilarity({ title: t.title, project_id: null, tag_ids: [] }).l1, t.actual_min, t.margin_min, t.completed_at);
  const ruleOf = (g: Group) => ((rules ?? []) as Array<{ subject_type: string; similarity_key: string; level: string; margin_min: number; updated_at: string }>)
    .filter((x) => x.subject_type === g.subject_type && x.similarity_key === g.key).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const findings: ReviewFinding[] = [];
  for (const g of [...groups.values()].sort((a, b) => b.latest.localeCompare(a.latest))) {
    const margin = ruleOf(g)?.margin_min ?? (g.taskMargins.length ? median(g.taskMargins) : null);
    if (!margin) continue;                              // لا هامش مضبوط لهذا المفتاح ⇒ لا «واضعين» يُقترح عليهم
    const f = reviewKey({ similarity_key: g.key, level: "L1", subject_type: g.subject_type, actuals: g.actuals, margin_min: margin, mode: p.age_mode });
    if (!f || blocked.has(dedupeKey(f))) continue;
    findings.push(f);
    if (findings.length >= r.max_per_run) break;
  }
  if (findings.length) {
    const expires = new Date(now.getTime() + r.reject_cooldown_days * DAY_MS).toISOString();
    await admin.from("adaptation_suggestions").insert(findings.map((f) => ({
      profile_id: p.id, type: r.suggestion_type, setting_key: null,
      proposed_value: { subject_type: f.subject_type, similarity_key: f.similarity_key, level: f.level, margin_min: f.proposed_min, current_min: f.margin_min, median_actual: f.median_actual, n: f.n },
      reason_short: reviewText(f), expected_effect: f.kind === "tight" ? content.review.effect_tight : content.review.effect_loose,
      audience: p.age_mode === "child" ? "guardian" : "owner", expires_at: expires, dedupe_key: dedupeKey(f), created_at: now.toISOString(),
    })));
  }
  return { created: findings };
}
/** مفتاح منع التكرار لكل مفتاح تشابه (لا للقيمة): الرفض يُسكت المفتاح كله مدة التهدئة. */
export const dedupeKey = (f: Pick<ReviewFinding, "subject_type" | "similarity_key">): string => `margin_adjustment:${f.subject_type}:${f.similarity_key}`;

export async function marginLog(db: Db, profileId: string, limit: number) {
  const [{ data: events }, { data: rules }] = await Promise.all([
    db.from("margin_events").select("id, actor_user_id, actor_role, subject_type, subject_id, system_default_min, set_min, apply_scope, reason_code, created_at").eq("profile_id", profileId).order("created_at", { ascending: false }).limit(limit),
    db.from("margin_rules").select("id, subject_type, similarity_key, level, margin_min, set_by, active, updated_at").eq("profile_id", profileId).eq("active", true).order("updated_at", { ascending: false }),
  ]);
  return { events: (events ?? []) as Array<{ id: string; actor_user_id: string | null; actor_role: string; subject_type: SubjectType; subject_id: string; system_default_min: number; set_min: number; apply_scope: string; reason_code: string | null; created_at: string }>,
    rules: (rules ?? []) as Array<{ id: string; subject_type: SubjectType; similarity_key: string; level: string; margin_min: number; set_by: string | null; active: boolean; updated_at: string }> };
}

/** ب.7: الدورة الأسبوعية (تُستدعى من /api/cron/tick). بلا ذكاء اصطناعي، فتعمل كما هي بالعلم AI_ENABLED=false. */
export async function runMarginReviewTick(admin: Db, now: Date, everyDays: number): Promise<{ reviewed: number; created: number }> {
  const [{ data: profs }, { data: runs }] = await Promise.all([
    admin.from("profiles").select("id, age_mode").eq("kind", "player"),
    admin.from("margin_review_runs").select("profile_id, last_run_at"),
  ]);
  const last = new Map(((runs ?? []) as Array<{ profile_id: string; last_run_at: string }>).map((r) => [r.profile_id, Date.parse(r.last_run_at)]));
  let reviewed = 0, created = 0;
  for (const p of (profs ?? []) as Array<{ id: string; age_mode: AgeMode | null }>) {
    if (!p.age_mode) continue;
    const prev = last.get(p.id);
    if (prev && now.getTime() - prev < everyDays * DAY_MS) continue;
    const r = await runMarginReview(admin, { id: p.id, age_mode: p.age_mode }, now);
    await admin.from("margin_review_runs").upsert({ profile_id: p.id, last_run_at: now.toISOString(), last_suggestions: r.created.length }, { onConflict: "profile_id" });
    reviewed++; created += r.created.length;
  }
  return { reviewed, created };
}
