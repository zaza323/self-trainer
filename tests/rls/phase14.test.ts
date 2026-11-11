/**
 * المرحلة 14 (0.5 الجزء ب) على قاعدة بيانات حقيقية — اختبارات ب.11:
 * 2 الأسبقية وقفل المنشئ، 3 الصلاحية والنطاق، 4 الحدود، 5 أوضاع التوصية، 6 العزل، 8 RLS، 9 المراجعة، 10 سجل كل ضبط،
 * 11 من ضبط الهامش ومن يقرأ الأحداث، 13 العمل بالعلم AI_ENABLED=false (الملف كله يعمل به)، وRULES-7 بفئاته الأربع.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { ai, margins, game, SUPPORT_LEVELS } from "../../src/shared/config";
import { setTaskMargin, extendMargin, resolveFor, traceResolved, runMarginReview, runMarginReviewTick, updateRule } from "../../src/modules/margins/service";
import { evaluateAndRecord } from "../../src/modules/evidence/service";
import { refreshGameState } from "../../src/modules/game/service";
import { deliverDue } from "../../src/modules/notifications/service";
import { fakeSender } from "../../src/modules/notifications/sender";
import { instantForLocal } from "../../src/modules/notifications/plan";
import { latestTrace } from "../../src/modules/trace/service";
import { TRACE_KINDS } from "../../src/modules/trace/rules";
import traceContent from "../../content/decision_trace.ar.json";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = new RlsHarness();
const TZ = "Asia/Amman";
const NOW = new Date();
let creator: TestUser, teacher: TestUser, viewer: TestUser, childUser: TestUser, teen: TestUser, teenG: TestUser, adultA: TestUser, adultB: TestUser, stranger: TestUser;
let childP: string, teenP: string, aP: string, bP: string;
let svc: SupabaseClient, teenDb: SupabaseClient;
const prevFlag = process.env[ai.ai_off.flag_env];

const one = async <T,>(sql: string, p: unknown[] = []) => (await h.service<T>(sql, p)).rows[0]!;
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(sql, p)).n;
const mission = async (profile: string, template = "rd-sim-01", createdBy: string | null = null) =>
  (await one<{ id: string }>(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, source, created_by) values ($1,$2,1,2,'L1_hint','engine',$3) returning id`, [profile, template, createdBy])).id;
const task = async (profile: string, title: string, o: { by?: string | null; via?: string } = {}) =>
  (await one<{ id: string }>(`insert into planner_tasks (profile_id, title, created_via, created_by) values ($1,$2,$3,$4) returning id`, [profile, title, o.via ?? "manual", o.by ?? null])).id;
const set = (actor: TestUser, type: "mission" | "planner_task", id: string, minutes: number, o: { scope?: "this_task" | "all_similar"; reason?: string; lock?: boolean } = {}) =>
  setTaskMargin(svc, { actorId: actor.id, type, id, minutes, applyScope: o.scope ?? "this_task", reason: o.reason ?? null, lock: o.lock }, NOW);
const marginRow = (table: "missions" | "planner_tasks", id: string) => one<{ margin_min: number | null; margin_source: string | null; margin_set_by: string | null; margin_locked: boolean; margin_extra_min: number }>(`select margin_min, margin_source, margin_set_by, margin_locked, margin_extra_min from ${table} where id = $1`, [id]);
const view = async (type: "mission" | "planner_task", id: string, db: SupabaseClient = svc, viewerId: string | null = null) => (await resolveFor(db, type, id, new Date(), { viewerId }))!.view;

beforeAll(async () => {
  process.env[ai.ai_off.flag_env] = "false";                       // ب.11-13: كل ما في الملف يعمل والذكاء الاصطناعي متوقف
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  const mk = (e: string) => h.createUser(`${e}14@test.local`);
  creator = await mk("cr"); teacher = await mk("te"); viewer = await mk("vw"); childUser = await mk("ch"); teen = await mk("tn"); teenG = await mk("tg"); adultA = await mk("aa"); adultB = await mk("ab"); stranger = await mk("st");
  const player = (u: TestUser, mode: string) => h.as(u, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','x',$2,$3) returning id`, [u.id, mode, TZ])).rows[0].id as string);
  teenP = await player(teen, "teen"); aP = await player(adultA, "adult"); bP = await player(adultB, "adult");
  for (const g of [creator, teacher, viewer, teenG]) await h.as(g, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','مربي')`, [g.id]));
  childP = (await one<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','k14','father','2026-11-05.1') as id`, [childUser.id, creator.id])).id;
  const invite = async (by: TestUser, profile: string, who: TestUser, relation: string, perms: Record<string, boolean>) => {
    const code = await h.as(by, async (q) => (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,$3,$4) returning code`, [profile, by.id, relation, perms])).rows[0].code);
    await h.as(who, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
  };
  await invite(creator, childP, teacher, "teacher", { set_task_margin: true });
  await invite(creator, childP, viewer, "other", { view_chat: true });
  await invite(teen, teenP, teenG, "teacher", { view_progress: true });
  teenDb = pgSupabaseShim(h.pool, teen);
});
afterAll(async () => { if (prevFlag === undefined) delete process.env[ai.ai_off.flag_env]; else process.env[ai.ai_off.flag_env] = prevFlag; await h.teardown(); });

describe("ب.2: الافتراضي للنطاق", () => {
  it("المنشئ all_tasks وغيره own_tasks", async () => {
    const rows = (await h.service<{ is_creator: boolean; margin_scope: string }>(`select is_creator, margin_scope from guardian_links where player_id = $1`, [childP])).rows;
    expect(rows.find((r) => r.is_creator)!.margin_scope).toBe(margins.permission.default_scope.creator_guardian);
    expect(rows.filter((r) => !r.is_creator).every((r) => r.margin_scope === margins.permission.default_scope.other_guardian)).toBe(true);
  });
});

describe("ب.11-3: الصلاحية والنطاق", () => {
  it("مربٍّ بلا set_task_margin مرفوض؛ own_tasks لا يعدّل مهمة أضافها غيره ويعدّل ما أضافه؛ الطفل يرى فقط؛ الغريب مرفوض", async () => {
    const m = await mission(childP);
    expect(await set(viewer, "mission", m, 30)).toEqual({ ok: false, error: "no_permission" });
    expect(await set(teacher, "mission", m, 30)).toEqual({ ok: false, error: "out_of_scope" });
    expect(await set(childUser, "mission", m, 30)).toEqual({ ok: false, error: "child_view_only" });
    expect(await set(stranger, "mission", m, 30)).toEqual({ ok: false, error: "not_allowed" });
    expect((await marginRow("missions", m)).margin_min).toBeNull();
    expect(await count(`select count(*)::int as n from margin_events where subject_id = $1`, [m])).toBe(0);
    const own = await task(childP, "واجب العلوم", { by: teacher.id, via: "guardian" });
    expect(await set(teacher, "planner_task", own, 30)).toMatchObject({ ok: true, margin_min: 30, source: "guardian" });
    const mine = await mission(childP, "rd-sim-01", teacher.id);
    expect(await set(teacher, "mission", mine, 20)).toMatchObject({ ok: true, margin_min: 20 });
  });
  it("مربٍّ في teen بلا منح مرفوض؛ وبمنح صريح ضمن نطاقه فقط", async () => {
    const m = await mission(teenP);
    expect(await set(teenG, "mission", m, 40)).toEqual({ ok: false, error: "no_permission" });
    await h.service(`update guardian_links set permissions = permissions || '{"set_task_margin":true}'::jsonb where player_id = $1 and guardian_id = $2`, [teenP, teenG.id]);
    expect(await set(teenG, "mission", m, 40)).toEqual({ ok: false, error: "out_of_scope" });
    await h.service(`update guardian_links set margin_scope = 'all_tasks' where player_id = $1 and guardian_id = $2`, [teenP, teenG.id]);
    expect(await set(teenG, "mission", m, 40)).toMatchObject({ ok: true, margin_min: 40, source: "guardian" });
  });
});

describe("ب.11-4 و10: الحدود وسجل كل ضبط", () => {
  it("خارج حدود الوضع تُقصّ، وغير مضاعف الخمس تُقرَّب؛ والحدث يحمل الافتراضي والمضبوط والنطاق والسبب", async () => {
    const m = await mission(childP);
    expect(await set(creator, "mission", m, 500, { reason: "needs_more_time" })).toMatchObject({ ok: true, margin_min: margins.bounds_min.child.max });
    expect(await set(creator, "mission", m, 22)).toMatchObject({ ok: true, margin_min: 25 });
    const ev = (await h.service<{ actor_role: string; actor_user_id: string; system_default_min: number; set_min: number; apply_scope: string; reason_code: string | null; similarity: { l1: string; l2: string } }>(
      `select actor_role, actor_user_id, system_default_min, set_min, apply_scope, reason_code, similarity from margin_events where subject_id = $1 order by created_at`, [m])).rows;
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ actor_role: "guardian", actor_user_id: creator.id, set_min: margins.bounds_min.child.max, apply_scope: "this_task", reason_code: "needs_more_time", similarity: { l1: "tpl:rd-sim-01" } });
    expect(ev[0]!.system_default_min).toBe(10);          // قالب 5–5 × معامل الطفل 1.25 = 6.25 ← 10
    expect(ev[1]).toMatchObject({ set_min: 25, reason_code: null });
    expect(await set(creator, "mission", m, 30, { reason: "invented" })).toEqual({ ok: false, error: "invalid_input" });
    expect(await h.failsAs(creator, `update margin_events set set_min = 1 where subject_id = $1`, [m])).not.toBeNull();
    await expect(h.service(`delete from margin_events where subject_id = $1`, [m])).rejects.toThrow(/append-only/);
  });
});

describe("ب.11-2: الأسبقية على القاعدة", () => {
  it("child: الافتراضي ← التوصية ← القاعدة ← تعديل المهمة؛ وأوضاع التوصية الثلاثة (ب.11-5)", async () => {
    const t1 = await task(childP, "مراجعة الرياضيات");
    expect(await view("planner_task", t1)).toMatchObject({ margin_min: margins.default_rule.age_default_min.child, source: "system", rule: "margin_default_age_default" });
    expect(await set(creator, "planner_task", t1, 35)).toMatchObject({ ok: true });
    const t2 = await task(childP, "مُراجعة الرياضيات 20 دقيقة اليوم");                       // نفس العنوان بعد التطبيع
    expect(await view("planner_task", t2)).toMatchObject({ margin_min: 35, source: "history", rule: "margin_history" });
    const mode = (v: string) => h.service(`insert into settings (profile_id, key, value, set_by_role, set_by_user_id) values ($1,'margin_history_mode',$2::jsonb,'guardian',$3) on conflict (profile_id, key, set_by_role) do update set value = excluded.value`, [childP, JSON.stringify(v), creator.id]);
    await mode("suggest_only");
    expect(await view("planner_task", t2)).toMatchObject({ margin_min: margins.default_rule.age_default_min.child, source: "system", suggestion: { value: 35, level: "L1" } });
    await mode("off");
    expect(await view("planner_task", t2)).toMatchObject({ source: "system", suggestion: null });
    await mode("prefill");
    expect(await set(creator, "planner_task", t1, 45, { scope: "all_similar" })).toMatchObject({ ok: true });
    expect(await view("planner_task", t2)).toMatchObject({ margin_min: 45, source: "guardian_rule" });
    expect(await set(creator, "planner_task", t2, 50)).toMatchObject({ ok: true });
    expect(await view("planner_task", t2)).toMatchObject({ margin_min: 50, source: "guardian", set_by: creator.id });
    expect(await view("planner_task", await task(childP, "ترتيب الغرفة"))).toMatchObject({ source: "system" });
  });
  it("child: قفل المنشئ ضد مربٍّ آخر (حتى لو نطاقه all_tasks)", async () => {
    const m = await mission(childP);
    await h.service(`update guardian_links set margin_scope = 'all_tasks' where player_id = $1 and guardian_id = $2`, [childP, teacher.id]);
    expect(await set(teacher, "mission", m, 20)).toMatchObject({ ok: true, margin_min: 20 });
    expect(await set(creator, "mission", m, 30, { lock: true })).toMatchObject({ ok: true, margin_min: 30 });
    expect((await marginRow("missions", m)).margin_locked).toBe(true);
    expect(await set(teacher, "mission", m, 60)).toEqual({ ok: false, error: "margin_locked" });
    expect(await marginRow("missions", m)).toMatchObject({ margin_min: 30, margin_set_by: creator.id });
    await h.service(`update guardian_links set margin_scope = 'own_tasks' where player_id = $1 and guardian_id = $2`, [childP, teacher.id]);
  });
  it("teen: تعديل المستخدم يغلب تعديل المربي ولو جاء المربي بعده", async () => {
    const m = await mission(teenP);
    expect(await set(teenG, "mission", m, 55)).toMatchObject({ ok: true, margin_min: 55, source: "guardian", applied: true });
    expect(await set(teen, "mission", m, 30)).toMatchObject({ ok: true, margin_min: 30, source: "user", applied: true });
    expect(await set(teenG, "mission", m, 60)).toMatchObject({ ok: true, margin_min: 30, source: "user", applied: false });
    expect(await marginRow("missions", m)).toMatchObject({ margin_min: 30, margin_source: "user", margin_set_by: teen.id });
    expect(await count(`select count(*)::int as n from margin_events where subject_id = $1`, [m])).toBe(3);   // كل ضبط يُسجَّل ولو لم يغلب
  });
});

describe("ب.11-11: من ضبط الهامش ومن يقرأ الأحداث", () => {
  it("المتدرب يرى «حدّده لك …» بصفة من ضبطه؛ ويقرأ أحداثه", async () => {
    const m = await mission(teenP, "pa-sim-01");
    await set(teenG, "mission", m, 45);
    expect((await view("mission", m, teenDb, teen.id)).set_by_label).toBe("حدّده لك معلمك");
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from margin_events where subject_id = $1`, [m])).rows[0].n)).toBe(1);
  });
  it("مربٍّ بلا view_progress ولا set_task_margin لا يقرأ الأحداث ولا القواعد؛ own_tasks يقرأ ما ضبطه هو فقط؛ الغريب لا شيء", async () => {
    const all = await count(`select count(*)::int as n from margin_events where profile_id = $1`, [childP]);
    const n = (u: TestUser, table: string) => h.as(u, async (q) => (await q(`select count(*)::int as n from ${table} where profile_id = $1`, [childP])).rows[0].n as number);
    expect(await n(viewer, "margin_events")).toBe(0);
    expect(await n(viewer, "margin_rules")).toBe(0);
    expect(await n(stranger, "margin_events")).toBe(0);
    expect(await n(creator, "margin_events")).toBe(all);
    const mineOnly = await count(`select count(*)::int as n from margin_events where profile_id = $1 and actor_user_id = $2`, [childP, teacher.id]);
    expect(mineOnly).toBeGreaterThan(0); expect(mineOnly).toBeLessThan(all);
    expect(await n(teacher, "margin_events")).toBe(mineOnly);
  });
});

describe("ب.11-8: RLS — لا كتابة مباشرة", () => {
  it("حساب مستخدم عادي وحساب مربٍّ: margin_events وmargin_rules وأعمدة الهامش في missions وplanner_tasks كلها مرفوضة", async () => {
    const m = await mission(teenP), t = await task(teenP, "قراءة");
    const cm = await mission(childP), ct = await task(childP, "قراءة");
    const ev = `insert into margin_events (profile_id, actor_user_id, actor_role, subject_type, subject_id, system_default_min, set_min, apply_scope) values ($1,$2,'player','mission',$3,10,200,'this_task')`;
    const rule = `insert into margin_rules (profile_id, set_by, subject_type, similarity_key, level, margin_min) values ($1,$2,'mission','tpl:rd-sim-01','L1',200)`;
    for (const [u, p, mi, ta] of [[teen, teenP, m, t], [creator, childP, cm, ct], [teacher, childP, cm, ct], [teenG, teenP, m, t]] as Array<[TestUser, string, string, string]>) {
      expect(await h.failsAs(u, ev, [p, u.id, mi]), "insert margin_events").toMatch(/permission denied|row-level security/);
      expect(await h.failsAs(u, rule, [p, u.id]), "insert margin_rules").toMatch(/permission denied|row-level security/);
      expect(await h.failsAs(u, `update margin_rules set margin_min = 200 where profile_id = $1`, [p])).toMatch(/permission denied/);
      expect(await h.failsAs(u, `delete from margin_rules where profile_id = $1`, [p])).toMatch(/permission denied/);
      expect(await h.failsAs(u, `delete from margin_events where profile_id = $1`, [p])).toMatch(/permission denied/);
      for (const col of ["margin_min = 200", "margin_source = 'user'", `margin_set_by = '${u.id}'`, "margin_locked = true", "margin_extra_min = 60"]) {
        expect(await h.failsAs(u, `update missions set ${col} where id = $1`, [mi]), `missions ${col}`).toMatch(/permission denied|server only/);
        expect(await h.failsAs(u, `update planner_tasks set ${col} where id = $1`, [ta]), `planner_tasks ${col}`).toMatch(/permission denied|server only/);
      }
      expect(await h.failsAs(u, `select public.set_task_margin($1,'mission',$2,200)`, [u.id, mi])).toMatch(/permission denied/);
      expect(await h.failsAs(u, `select public.extend_task_margin($1,'mission',$2,5)`, [u.id, mi])).toMatch(/permission denied/);
      expect(await h.failsAs(u, `insert into decision_traces (profile_id, kind, rule) values ($1,'time_margin','x')`, [p])).toMatch(/permission denied|row-level security/);
    }
    expect(await h.failsAs(teen, `insert into missions (profile_id, template_id, template_version, difficulty, support_level, margin_min, margin_source) values ($1,'rd-sim-01',1,2,'L1_hint',200,'user')`, [teenP])).toMatch(/server only|permission denied/);
    expect(await h.failsAs(teen, `insert into planner_tasks (profile_id, title, margin_min) values ($1,'x',200)`, [teenP])).toMatch(/server only|permission denied/);
    for (const [table, id] of [["missions", m], ["planner_tasks", t], ["missions", cm], ["planner_tasks", ct]] as Array<["missions" | "planner_tasks", string]>) expect(await marginRow(table, id)).toMatchObject({ margin_min: null, margin_source: null, margin_locked: false, margin_extra_min: 0 });
    // المتصفح ما زال يعدّل بقية الأعمدة (الصلاحيات على الأعمدة لم تكسر التدفق العادي)
    expect(await h.failsAs(teen, `update planner_tasks set title = 'قراءة كتاب' where id = $1`, [t])).toBeNull();
  });
});

async function runMission(u: TestUser, profile: string, between: (id: string) => Promise<void>) {
  const id = await h.as(u, async (q) => (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, context_tag) values ($1,'sm-real-01',1,3,'L2_ask','home') returning id`, [profile])).rows[0].id as string);
  await h.as(u, async (q) => {
    await q(`select app.transition_mission($1,'chosen')`, [id]);
    await q(`update missions set strategy_chosen = 's1', time_estimate = 20, prediction = '{"minutes":20}' where id = $1`, [id]);
    await q(`select app.transition_mission($1,'planned')`, [id]);
    await q(`select app.transition_mission($1,'in_progress')`, [id]);
  });
  await between(id);
  await h.as(u, async (q) => {
    await q(`select app.transition_mission($1,'completed')`, [id]);
    await q(`update missions set actual_duration_min = 30 where id = $1`, [id]);
    await q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[{"prompt":"س","answer":"ج"}]')`, [id]);
    await q(`select app.transition_mission($1,'reflected')`, [id]);
  });
  const r = await evaluateAndRecord(svc, id);
  const ev = (await h.service(`select capability_id, type, rule_id, value::float8 as value, rule_weight::float8 as rule_weight, source from evidence_events where mission_id = $1 order by capability_id, type, rule_id`, [id])).rows;
  const xp = (await h.service(`select reason, amount from xp_events where source_id = $1 order by reason`, [id])).rows;
  const m = await one<{ gate1: boolean; gate2: string; gate2_score: number; time_estimate: number; prediction: unknown; actual_duration_min: number }>(`select gate1, gate2, gate2_score::float8 as gate2_score, time_estimate, prediction, actual_duration_min from missions where id = $1`, [id]);
  return { id, r: { events: r.events, gate2: r.gate2, gate2_score: r.gate2_score, xp: r.xp }, ev, xp, m };
}

describe("ب.11-6: العزل — الهامش لا يغيّر الأدلة ولا XP ولا البوابات", () => {
  it("إكمال بعد انتهاء الهامش، وتغيير الهامش بين التقدير والإنجاز، ثم زيادة: اللقطة مطابقة لمهمة بلا هامش", async () => {
    const a = await runMission(adultA, aP, async () => {});
    const b = await runMission(adultB, bP, async (id) => {
      expect(await setTaskMargin(svc, { actorId: adultB.id, type: "mission", id, minutes: 5, applyScope: "this_task" }, NOW)).toMatchObject({ ok: true, margin_min: 5 });   // الإنجاز (30) بعد نهاية الهامش (5)
      expect(await setTaskMargin(svc, { actorId: adultB.id, type: "mission", id, minutes: 240, applyScope: "all_similar" }, NOW)).toMatchObject({ ok: true, margin_min: 240 });
      expect(await extendMargin(svc, { actorId: adultB.id, type: "mission", id, minutes: margins.at_expiry.extension_options_min[0]! })).toEqual({ ok: true, extra_min: margins.at_expiry.extension_options_min[0] });
      expect(await extendMargin(svc, { actorId: adultB.id, type: "mission", id, minutes: 7 })).toEqual({ ok: false, error: "invalid_input" });
      expect(await extendMargin(svc, { actorId: stranger.id, type: "mission", id, minutes: 5 })).toEqual({ ok: false, error: "not_allowed" });
    });
    expect(a.ev.some((e) => (e as { type: string }).type === "prediction_accuracy")).toBe(true);
    expect(b.ev).toEqual(a.ev);          // prediction_accuracy يقيس تقدير المستخدم (20 مقابل 30) لا هامش أحد
    expect(b.xp).toEqual(a.xp);
    expect(b.r).toEqual(a.r);
    expect(b.m).toEqual(a.m);           // تقدير المستخدم باقٍ كما كتبه
    expect(await marginRow("missions", b.id)).toMatchObject({ margin_min: 240, margin_extra_min: margins.at_expiry.extension_options_min[0] });
    expect(await count(`select count(*)::int as n from evidence_events where profile_id = $1 and (rule_id ilike '%margin%' or type::text ilike '%margin%')`, [bP])).toBe(0);
  });
});

describe("ب.11-9: مراجعة الهامش بالقواعد", () => {
  const done = (n: number, at: Date) => h.service(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, source, status, completed_at, actual_duration_min, gate1) select $1,'dc-sim-01',1,2,'L1_hint','engine','reflected',$2,28,true from generate_series(1,$3)`, [teenP, at.toISOString(), n]);
  const pending = () => h.service<{ id: string; reason_short: string; proposed_value: { margin_min: number; similarity_key: string }; audience: string }>(`select id, reason_short, proposed_value, audience from adaptation_suggestions where profile_id = $1 and type = 'margin_adjustment' and decision is null`, [teenP]);
  it("5 إنجازات بوسيط 1.4× الهامش ⇒ اقتراح margin_adjustment بلا ذكاء اصطناعي؛ الرفض يُسكته 30 يومًا؛ الموافقة تنشئ قاعدة", async () => {
    const seed = await mission(teenP, "dc-sim-01");
    expect(await set(teen, "mission", seed, 20, { scope: "all_similar" })).toMatchObject({ ok: true, margin_min: 20 });
    await done(margins.review.min_completions - 1, new Date(NOW.getTime() - 86400000));
    expect((await runMarginReview(svc, { id: teenP, age_mode: "teen" }, NOW)).created).toHaveLength(0);       // أقل من 5
    await done(1, new Date(NOW.getTime() - 86400000));
    const r1 = await runMarginReview(svc, { id: teenP, age_mode: "teen" }, NOW);
    expect(r1.created).toHaveLength(1);
    expect(r1.created[0]).toMatchObject({ kind: "tight", n: 5, median_actual: 28, margin_min: 20, proposed_min: 35, similarity_key: "tpl:dc-sim-01" });
    const p1 = (await pending()).rows;
    expect(p1).toHaveLength(1);
    expect(p1[0]).toMatchObject({ reason_short: "آخر 5 مرات احتاج 28 دقيقة والهامش 20. تعدّله؟", audience: "owner", proposed_value: { margin_min: 35 } });
    expect(await count(`select count(*)::int as n from margin_rules where profile_id = $1 and similarity_key = 'tpl:dc-sim-01' and active and margin_min = 20`, [teenP])).toBe(1);   // لا تطبيق قبل الموافقة
    expect((await runMarginReview(svc, { id: teenP, age_mode: "teen" }, NOW)).created).toHaveLength(0);       // معلّق ⇒ لا تكرار
    await h.as(teen, (q) => q(`select public.decide_adaptation_suggestion($1,'rejected')`, [p1[0]!.id]));
    expect((await runMarginReview(svc, { id: teenP, age_mode: "teen" }, NOW)).created).toHaveLength(0);       // مرفوض ⇒ ساكت
    const almost = new Date(NOW.getTime() + (margins.review.reject_cooldown_days - 2) * 86400000);
    await done(margins.review.min_completions, new Date(almost.getTime() - 86400000));
    expect((await runMarginReview(svc, { id: teenP, age_mode: "teen" }, almost)).created).toHaveLength(0);   // ما زال داخل مدة السكوت
    const later = new Date(NOW.getTime() + (margins.review.reject_cooldown_days + 1) * 86400000);
    await done(margins.review.min_completions, new Date(later.getTime() - 86400000));
    expect((await runMarginReview(svc, { id: teenP, age_mode: "teen" }, later)).created).toHaveLength(1);
    const p2 = (await pending()).rows;
    await h.as(teen, (q) => q(`select public.decide_adaptation_suggestion($1,'accepted')`, [p2[0]!.id]));
    const rules = (await h.service<{ margin_min: number; active: boolean }>(`select margin_min, active from margin_rules where profile_id = $1 and similarity_key = 'tpl:dc-sim-01' order by created_at`, [teenP])).rows;
    expect(rules).toEqual([{ margin_min: 20, active: false }, { margin_min: 35, active: true }]);
    expect(await view("mission", await mission(teenP, "dc-sim-01"))).toMatchObject({ margin_min: 35, source: "user" });
    expect(await count(`select count(*)::int as n from ai_calls where profile_id = $1`, [teenP])).toBe(0);
  });
  it("الدورة المجدولة تمر على المتدربين مرة كل فترة؛ وG18: تعديل قاعدة وإيقافها عبر الخادم فقط", async () => {
    const t1 = await runMarginReviewTick(svc, NOW, 7);
    expect(t1.reviewed).toBeGreaterThan(0);
    expect((await runMarginReviewTick(svc, NOW, 7)).reviewed).toBe(0);
    const rule = await one<{ id: string }>(`select id from margin_rules where profile_id = $1 and active limit 1`, [teenP]);
    expect(await updateRule(svc, { actorId: teenG.id, ruleId: rule.id, minutes: 60 })).toEqual({ ok: false, error: "not_allowed" });
    expect(await updateRule(svc, { actorId: teen.id, ruleId: rule.id, minutes: 41 })).toEqual({ ok: true });
    expect((await one<{ margin_min: number }>(`select margin_min from margin_rules where id = $1`, [rule.id])).margin_min).toBe(45);
    expect(await updateRule(svc, { actorId: teen.id, ruleId: rule.id, active: false })).toEqual({ ok: true });
    expect((await one<{ active: boolean }>(`select active from margin_rules where id = $1`, [rule.id])).active).toBe(false);
  });
});

describe("RULES-7: decision_trace للقرارات الظاهرة — الفئات الأربع", () => {
  const known = (t: { text: string } | null) => { expect(t).not.toBeNull(); expect(t!.text.length).toBeGreaterThan(0); expect(t!.text).not.toBe(traceContent.unknown); expect(t!.text).not.toMatch(/\{\w+\}/); };
  it("هامش الوقت: ضبط إنسان يكتب أثرًا، وحل النظام يكتب أثرًا بأساسه؛ بلا تكرار للقرار نفسه", async () => {
    const m = await mission(childP, "pa-sim-01");
    const r = (await resolveFor(svc, "mission", m, NOW))!;
    expect(await traceResolved(svc, r.ctx, r.view, NOW)).toBe(true);
    expect(await traceResolved(svc, r.ctx, r.view, NOW)).toBe(false);
    const sys = await latestTrace(svc, childP, "time_margin", m);
    expect(sys).toMatchObject({ rule: "margin_default_template_range", decision: { margin_min: r.view.margin_min, source: "system" } });
    known(sys);
    await set(creator, "mission", m, 30);
    const man = await latestTrace(svc, childP, "time_margin", m);
    expect(man).toMatchObject({ rule: "margin_guardian_this_task", decision: { margin_min: 30, source: "guardian", set_by: creator.id }, inputs: { requested_min: 30, apply_scope: "this_task", actor_role: "guardian" } });
    known(man);
  });
  it("مستوى الدعم: تغيّره يكتب أثرًا بالقدرة ومن/إلى", async () => {
    const before = (await one<{ support_level: string }>(`select support_level from capability_states where profile_id = $1 and capability_id = 'attention'`, [aP])).support_level;
    let after = before;
    for (let i = 0; i < 8 && after === before; i++) {
      const id = await h.as(adultA, async (q) => {
        const mid = (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,'rd-sim-01',1,2,$2) returning id`, [aP, before])).rows[0].id as string;
        await q(`select app.transition_mission($1,'chosen')`, [mid]);
        await q(`update missions set strategy_chosen = 's3', time_estimate = 5 where id = $1`, [mid]);
        await q(`select app.transition_mission($1,'planned')`, [mid]);
        await q(`select app.transition_mission($1,'in_progress')`, [mid]);
        await q(`update missions set distraction_log = '[{"at":"x","choice":"ignore"},{"at":"x","choice":"ignore"}]' where id = $1`, [mid]);
        await q(`select app.transition_mission($1,'completed')`, [mid]);
        await q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[{"prompt":"س","answer":"ج"}]')`, [mid]);
        await q(`select app.transition_mission($1,'reflected')`, [mid]);
        return mid;
      });
      await evaluateAndRecord(svc, id);
      after = (await one<{ support_level: string }>(`select support_level from capability_states where profile_id = $1 and capability_id = 'attention'`, [aP])).support_level;
    }
    expect(after).not.toBe(before);
    const t = await latestTrace(svc, aP, "support_level", "attention");
    expect(t).toMatchObject({ rule: SUPPORT_LEVELS.indexOf(after as never) > SUPPORT_LEVELS.indexOf(before as never) ? "support_up" : "support_down", decision: { from: before, to: after }, inputs: { capability_id: "attention" } });
    known(t);
  });
  it("مرحلة الحوافز: الانتقال يكتب أثرًا بمدخلاته", async () => {
    const r = game.incentive_stages.advance["1_attract_to_2_competence"];
    const onboarded = new Date(NOW.getTime() - (r.min_days_since_onboarding + 1) * 86400000).toISOString();
    await h.service(`update profiles set incentive_stage = 1, onboarded_at = $2 where id = $1`, [bP, onboarded]);
    await h.service(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, source, status, completed_at, gate1) select $1,'rd-sim-01',1,2,'L1_hint','engine','reflected', now(), true from generate_series(1,$2)`, [bP, r.min_reflected_missions]);
    await h.service(`insert into capability_states (profile_id, capability_id, support_level) select $1, id, 'L1_hint' from capabilities on conflict do nothing`, [bP]);
    await h.service(`insert into capability_snapshots (profile_id, capability_id, date, score, confidence, training_level, support_level, phrase_key, config_version) select $1, id, current_date, 50, 0.9, 'simulated', 'L1_hint', 'x', 'test' from capabilities on conflict (profile_id, capability_id, date) do update set confidence = 0.9`, [bP]);
    const p = await one<{ id: string; age_mode: "adult"; incentive_stage: number; avatar_stage_max: number; onboarded_at: string | null; created_at: string }>(`select id, age_mode, incentive_stage, avatar_stage_max, onboarded_at, created_at from profiles where id = $1`, [bP]);
    const s = await refreshGameState(svc, p, NOW);
    expect(s).toMatchObject({ stage: 2, stage_changed: true });
    const t = await latestTrace(svc, bP, "incentive_stage", bP);
    expect(t).toMatchObject({ rule: "stage_advance", decision: { from: 1, to: 2 } });
    expect((t!.inputs as { reflected_missions: number }).reflected_missions).toBeGreaterThanOrEqual(r.min_reflected_missions);
    known(t);
  });
  it("سبب تأجيل الإشعار: التأجيل بالحد اليومي يكتب أثرًا بسببه", async () => {
    const now = instantForLocal("2026-11-12", "17:05", TZ);
    await h.as(teen, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'notification_max_per_day','1','player') on conflict (profile_id, key, set_by_role) do update set value = excluded.value`, [teenP]));
    await h.service(`delete from notifications where profile_id = $1`, [teenP]);
    await h.service(`insert into notifications (profile_id, type, scheduled_for, dedupe_key) values ($1,'mission_today',$2,'p14-1'), ($1,'comeback',$2,'p14-2')`, [teenP, new Date(now.getTime() - 60000).toISOString()]);
    const r = await deliverDue(svc, fakeSender(), now);
    expect(r.deferred).toBeGreaterThanOrEqual(1);
    const deferred = await one<{ id: string }>(`select id from notifications where profile_id = $1 and sent_at is null and deferred_count > 0`, [teenP]);
    const t = await latestTrace(svc, teenP, "notification_defer", deferred.id);
    expect(t).toMatchObject({ rule: "notification_defer_cap", decision: { reason: "cap" } });
    known(t);
  });
  it("الفئات الأربع كلها مكتوبة، ولكل قاعدة مسجلة قالب نص ثابت؛ والقراءة للمالك ومربي view_progress فقط", async () => {
    const kinds = (await h.service<{ kind: string }>(`select distinct kind from decision_traces`)).rows.map((x) => x.kind).sort();
    expect(kinds).toEqual([...TRACE_KINDS].sort());
    const rules = (await h.service<{ rule: string }>(`select distinct rule from decision_traces`)).rows.map((x) => x.rule);
    for (const rule of rules) expect(Object.keys(traceContent.rules), rule).toContain(rule);
    const n = (u: TestUser, p: string) => h.as(u, async (q) => (await q(`select count(*)::int as n from decision_traces where profile_id = $1`, [p])).rows[0].n as number);
    expect(await n(teen, teenP)).toBeGreaterThan(0);
    expect(await n(teenG, teenP)).toBeGreaterThan(0);       // view_progress
    expect(await n(viewer, childP)).toBe(0);
    expect(await n(stranger, teenP)).toBe(0);
  });
});

describe("ب.11-13: العمل بالعلم AI_ENABLED=false كاملًا", () => {
  it("كل ما سبق جرى والعلم متوقف، ولم يُسجَّل أي استدعاء نموذج", async () => {
    expect(process.env[ai.ai_off.flag_env]).toBe("false");
    expect(await count(`select count(*)::int as n from ai_calls where profile_id = any($1)`, [[childP, teenP, aP, bP]])).toBe(0);
    expect(await count(`select count(*)::int as n from margin_events`)).toBeGreaterThan(10);
  });
});
