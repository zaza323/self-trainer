/**
 * المتصفح لا يكتب مباشرة على جداول الوتيرة والنقاط والأدلة والمكافآت (الهجرة 0017).
 * مستخدم عادي (صاحب الملف نفسه) يحاول insert/update/delete على كل جدول، ويستدعي دوال الكتابة مباشرة: كلها تُرفض،
 * والصف يبقى كما هو. الكتابة تمر فقط عبر أفعال الخادم (عميل الخدمة) بهوية الجلسة.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";

const h = new RlsHarness();
let adult: TestUser, profile: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await h.setup();
  adult = await h.createUser("dw@test.local");
  profile = await h.as(adult, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','بالغ','adult') returning id`, [adult.id])).rows[0].id);
  // صفوف حقيقية للملف نفسه (يكتبها الخادم) ليحاول المستخدم تعديلها أو حذفها
  ids.growth = (await h.service<{ id: string }>(`insert into growth_increments (profile_id, week_start, kind, metric, from_value, target_value) values ($1, '2026-11-07', 'longer', 'focus_minutes_per_day', 20, 22) returning id`, [profile])).rows[0]!.id;
  await h.service(`insert into pace_baselines (profile_id, metric, week_start, baseline, sample_days) values ($1, 'focus_minutes_per_day', '2026-11-07', 20, 10)`, [profile]);
  ids.xp = (await h.service<{ id: string }>(`insert into xp_events (profile_id, amount, reason, source_id) values ($1, 5, 'habit_checkin', 'dw-1') returning id`, [profile])).rows[0]!.id;
  ids.evidence = (await h.service<{ id: string }>(`insert into evidence_events (profile_id, capability_id, rule_id, source, type, value, rule_weight, weight, context_tag, support_level, config_version) values ($1, 'planning', 'P4', 'auto', 'strategy_fit', 0.5, 0.5, 0.5, 'planner', 'L2_ask', 'x') returning id`, [profile])).rows[0]!.id;
  ids.reward = (await h.service<{ id: string }>(`select public.reward_create($1, $2, 'كتاب', null, null, 'transfer_reports', '{"count":2}'::jsonb, 'active') as id`, [adult.id, profile])).rows[0]!.id;
});
afterAll(() => h.teardown());

const rejected = async (sql: string, params: unknown[]) => { const err = await h.failsAs(adult, sql, params); expect(err, sql).not.toBeNull(); return err!; };

describe("لا كتابة مباشرة من حساب مستخدم عادي", () => {
  it("growth_increments: insert/update/delete مرفوضة، والصف لا يتغير", async () => {
    expect(await rejected(`insert into growth_increments (profile_id, week_start, kind) values ($1, '2026-11-14', 'hold')`, [profile])).toMatch(/permission denied/);
    expect(await rejected(`update growth_increments set target_value = 999, status = 'accepted', over_cap = false where id = $1`, [ids.growth])).toMatch(/permission denied/);
    expect(await rejected(`delete from growth_increments where id = $1`, [ids.growth])).toMatch(/permission denied/);
    const row = (await h.service<{ target_value: string; status: string }>(`select target_value, status from growth_increments where id = $1`, [ids.growth])).rows[0]!;
    expect([Number(row.target_value), row.status]).toEqual([22, "proposed"]);
  });
  it("decide_increment لا تُستدعى من المتصفح (كانت تسمح بتجاوز فحص السقف)", async () => {
    expect(await rejected(`select public.decide_increment($1, $2, 'edited', 999, false, false)`, [adult.id, ids.growth])).toMatch(/permission denied/);
    expect(await rejected(`select app.decide_increment($1, $2, 'edited', 999, false, false)`, [adult.id, ids.growth])).toMatch(/permission denied/);
    expect((await h.service<{ status: string }>(`select status from growth_increments where id = $1`, [ids.growth])).rows[0]!.status).toBe("proposed");
  });
  it("pace_baselines: insert/update/delete مرفوضة", async () => {
    expect(await rejected(`insert into pace_baselines (profile_id, metric, week_start, baseline, sample_days) values ($1, 'x', '2026-11-14', 1, 1)`, [profile])).toMatch(/permission denied/);
    expect(await rejected(`update pace_baselines set baseline = 999 where profile_id = $1`, [profile])).toMatch(/permission denied/);
    expect(await rejected(`delete from pace_baselines where profile_id = $1`, [profile])).toMatch(/permission denied/);
    expect(Number((await h.service<{ baseline: string }>(`select baseline from pace_baselines where profile_id = $1`, [profile])).rows[0]!.baseline)).toBe(20);
  });
  it("xp_events: لا يمنح المستخدم نفسه نقاطًا ولا يعدّلها", async () => {
    expect(await rejected(`insert into xp_events (profile_id, amount, reason, source_id) values ($1, 500, 'habit_checkin', 'dw-hack')`, [profile])).toMatch(/permission denied/);
    expect(await rejected(`update xp_events set amount = 500 where id = $1`, [ids.xp])).toMatch(/permission denied/);
    expect(await rejected(`delete from xp_events where id = $1`, [ids.xp])).toMatch(/permission denied/);
    expect((await h.service<{ s: number }>(`select coalesce(sum(amount),0)::int as s from xp_events where profile_id = $1`, [profile])).rows[0]!.s).toBe(5);
  });
  it("evidence_events: لا يكتب المستخدم أدلة ولا يعدّلها", async () => {
    expect(await rejected(`insert into evidence_events (profile_id, capability_id, rule_id, source, type, value, rule_weight, weight, context_tag, support_level, config_version) values ($1, 'planning', 'P4', 'self', 'strategy_fit', 1, 1, 1, 'x', 'L3_free', 'x')`, [profile])).toMatch(/permission denied/);
    expect(await rejected(`update evidence_events set value = 1 where id = $1`, [ids.evidence])).toMatch(/permission denied/);
    expect(await rejected(`delete from evidence_events where id = $1`, [ids.evidence])).toMatch(/permission denied/);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where profile_id = $1`, [profile])).rows[0]!.n).toBe(1);
  });
  it("rewards: لا إنشاء ولا تعديل حقول ولا تغيير حالة مباشرة، ولا استدعاء مباشر لدالتي الكتابة", async () => {
    expect(await rejected(`insert into rewards (profile_id, created_by, title, trigger_type, trigger_params) values ($1, $2, 'x', 'transfer_reports', '{"count":2}')`, [profile, adult.id])).toMatch(/permission denied/);
    expect(await rejected(`update rewards set title = 'غيّرته', trigger_params = '{"count":1}' where id = $1`, [ids.reward])).toMatch(/permission denied/);
    expect(await rejected(`update rewards set status = 'earned' where id = $1`, [ids.reward])).toMatch(/permission denied/);
    expect(await rejected(`delete from rewards where id = $1`, [ids.reward])).toMatch(/permission denied/);
    expect(await rejected(`select public.reward_create($1, $2, 'x', null, null, 'transfer_reports', '{"count":2}'::jsonb, 'draft')`, [adult.id, profile])).toMatch(/permission denied/);
    expect(await rejected(`select * from public.reward_transition($1, $2, 'earned')`, [adult.id, ids.reward])).toMatch(/permission denied/);
    const row = (await h.service<{ title: string; status: string; trigger_params: { count: number } }>(`select title, status, trigger_params from rewards where id = $1`, [ids.reward])).rows[0]!;
    expect(row).toEqual({ title: "كتاب", status: "active", trigger_params: { count: 2 } });
  });
  it("القراءة ما زالت مسموحة لصاحب الملف", async () => {
    const n = await h.as(adult, async (q) => (await q(`select (select count(*) from growth_increments) + (select count(*) from pace_baselines) + (select count(*) from xp_events) + (select count(*) from evidence_events) + (select count(*) from rewards) as n`)).rows[0].n);
    expect(Number(n)).toBe(5);
  });
});
