/**
 * اختبارات RLS وآلة الحالات للمرحلة 1: الغايات (عمق، دورات، إدراج فوق)، القوالب، المهام (الانتقالات، التجميد، البوابة الأولى، التأمل).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { limits } from "../../src/shared/config";

const h = new RlsHarness();
let teen: TestUser, stranger: TestUser, guardian: TestUser;
let teenProfile: string;

beforeAll(async () => {
  await h.setup();
  teen = await h.createUser("t1@test.local");
  stranger = await h.createUser("s1@test.local");
  guardian = await h.createUser("g1@test.local");
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','مراهق','teen') returning id`, [teen.id])).rows[0].id);
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));
  await h.as(guardian, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','أب')`, [guardian.id]));
  const code = await h.as(teen, async (q) => (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'father','{"view_progress":true}') returning code`, [teenProfile, teen.id])).rows[0].code);
  await h.as(guardian, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
});
afterAll(() => h.teardown());

describe("الغايات (GOAL-1، GOAL-3، GOAL-5)", () => {
  let root: string, mid: string, leaf: string;
  it("المالك ينشئ سلسلة، والمربي بـ view_progress يقرأ، والغريب لا", async () => {
    root = await h.as(teen, async (q) => (await q(`insert into goals (profile_id, title, why) values ($1,'أصبح شخصًا يُعتمد عليه','لأن أهلي يثقون بي') returning id`, [teenProfile])).rows[0].id);
    mid = await h.as(teen, async (q) => (await q(`insert into goals (profile_id, parent_goal_id, title) values ($1,$2,'أنجح في الفصل') returning id`, [teenProfile, root])).rows[0].id);
    leaf = await h.as(teen, async (q) => (await q(`insert into goals (profile_id, parent_goal_id, title) values ($1,$2,'أنهي واجباتي قبل العشاء') returning id`, [teenProfile, mid])).rows[0].id);
    expect(await h.as(guardian, async (q) => (await q(`select count(*)::int as n from goals where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(3);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from goals where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(0);
    expect(await h.failsAs(stranger, `insert into goals (profile_id, title) values ($1,'x')`, [teenProfile])).toMatch(/row-level security/);
  });
  it("منع الدورات في الخادم", async () => {
    expect(await h.failsAs(teen, `update goals set parent_goal_id = $2 where id = $1`, [root, leaf])).toMatch(/cycle/);
    expect(await h.failsAs(teen, `update goals set parent_goal_id = $1 where id = $1`, [mid])).toMatch(/own parent/);
  });
  it("إدراج حلقة فوق الجذر وبين حلقتين دون فقدان الأبناء", async () => {
    const newRoot = await h.as(teen, async (q) => (await q(`select app.insert_goal_above($1,'أعيش حياة ذات معنى',null) as id`, [root])).rows[0].id);
    const r = await h.service<{ parent_goal_id: string | null }>(`select parent_goal_id from goals where id = $1`, [root]);
    expect(r.rows[0]!.parent_goal_id).toBe(newRoot);
    const between = await h.as(teen, async (q) => (await q(`select app.insert_goal_above($1,'أفهم الوحدة',null) as id`, [leaf])).rows[0].id);
    const l = await h.service<{ parent_goal_id: string | null }>(`select parent_goal_id from goals where id = $1`, [leaf]);
    expect(l.rows[0]!.parent_goal_id).toBe(between);
    const b = await h.service<{ parent_goal_id: string | null }>(`select parent_goal_id from goals where id = $1`, [between]);
    expect(b.rows[0]!.parent_goal_id).toBe(mid);
    expect(await h.failsAs(stranger, `select app.insert_goal_above($1,'x',null)`, [mid])).toMatch(/not allowed/);
  });
  it("حد العمق من config/limits.json يُطبَّق", async () => {
    let parent = leaf;
    const start = (await h.service<{ d: number }>(`select app.goal_depth($1) as d`, [leaf])).rows[0]!.d;
    for (let i = start; i < limits.goal_max_depth; i++) {
      parent = await h.as(teen, async (q) => (await q(`insert into goals (profile_id, parent_goal_id, title) values ($1,$2,$3) returning id`, [teenProfile, parent, `حلقة ${i + 1}`])).rows[0].id);
    }
    expect(await h.failsAs(teen, `insert into goals (profile_id, parent_goal_id, title) values ($1,$2,'زيادة')`, [teenProfile, parent])).toMatch(/depth exceeds/);
    expect(await h.failsAs(teen, `select app.insert_goal_above($1,'x',null)`, [parent])).toMatch(/depth exceeds/);
    const depth = await h.service<{ d: number }>(`select app.goal_depth($1) as d`, [parent]);
    expect(depth.rows[0]!.d).toBe(limits.goal_max_depth);
  });

});

describe("القوالب (LIB-1)", () => {
  it("20 قالبًا نشطًا مقروءة لكل مسجل، ولا تُعدَّل من المتصفح", async () => {
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from mission_templates`)).rows[0].n)).toBe(20);
    expect(await h.failsAs(teen, `update mission_templates set difficulty = 5 where id = 'rd-sim-01'`)).toMatch(/permission denied|row-level security/);
  });
});

describe("المهام وآلة الحالات (MIS-1، GATE-1)", () => {
  let mission: string;
  it("المالك يدرج اقتراحًا؛ الغريب لا؛ gate2 لا يُدرج من المتصفح", async () => {
    mission = await h.as(teen, async (q) => (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, variables, suggested_for) values ($1,'rd-sim-01',1,2,'L1_hint','{"time_budget":5,"context":"قراءة"}', current_date) returning id`, [teenProfile])).rows[0].id);
    expect(await h.failsAs(stranger, `insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,'rd-sim-01',1,2,'L1_hint')`, [teenProfile])).toMatch(/row-level security/);
    expect(await h.failsAs(teen, `insert into missions (profile_id, template_id, template_version, difficulty, support_level, gate2) values ($1,'rd-sim-01',1,2,'L1_hint','shown')`, [teenProfile])).toMatch(/row-level security/);
    const tr = await h.service<{ n: number }>(`select count(*)::int as n from mission_transitions where mission_id = $1 and from_status is null and to_status = 'suggested'`, [mission]);
    expect(tr.rows[0]!.n).toBe(1);
  });
  it("لا قفز في الحالات؛ المسار الكامل مسجّل بوقته", async () => {
    expect(await h.failsAs(teen, `select app.transition_mission($1,'in_progress')`, [mission])).toMatch(/not allowed/);
    await h.as(teen, (q) => q(`select app.transition_mission($1,'chosen')`, [mission]));
    await h.as(teen, (q) => q(`update missions set strategy_chosen = 's1', time_estimate = 5 where id = $1`, [mission]));
    await h.as(teen, (q) => q(`select app.transition_mission($1,'planned','{"strategy":"s1"}')`, [mission]));
    await h.as(teen, (q) => q(`select app.transition_mission($1,'in_progress')`, [mission]));
    const started = await h.service<{ started_at: string | null }>(`select started_at from missions where id = $1`, [mission]);
    expect(started.rows[0]!.started_at).not.toBeNull();
    await h.as(teen, (q) => q(`update missions set distraction_log = '[{"at":"x","choice":"ignore"},{"at":"y","choice":"break_return"}]' where id = $1`, [mission]));
    await h.as(teen, (q) => q(`select app.transition_mission($1,'interrupted')`, [mission]));
    await h.as(teen, (q) => q(`select app.transition_mission($1,'in_progress','{"reason":"اتصال"}')`, [mission]));
    expect(await h.failsAs(stranger, `select app.transition_mission($1,'completed')`, [mission])).toMatch(/not allowed/);
    await h.as(teen, (q) => q(`select app.transition_mission($1,'completed','{"check":"timer"}')`, [mission]));
    const m = await h.service<{ gate1: boolean; completed_at: string | null; actual_duration_min: number }>(`select gate1, completed_at, actual_duration_min from missions where id = $1`, [mission]);
    expect(m.rows[0]!.gate1).toBe(true);
    expect(m.rows[0]!.completed_at).not.toBeNull();
    expect(m.rows[0]!.actual_duration_min).toBeGreaterThanOrEqual(1);
    const path = await h.service<{ to_status: string; meta: unknown }>(`select to_status, meta from mission_transitions where mission_id = $1 order by at`, [mission]);
    expect(path.rows.map((r) => r.to_status)).toEqual(["suggested", "chosen", "planned", "in_progress", "interrupted", "in_progress", "completed"]);
    expect(path.rows[2]!.meta).toEqual({ strategy: "s1" });
  });
  it("الوقائع تتجمد بعد الحسم، والتأمل شرط للانتقال إلى reflected", async () => {
    expect(await h.failsAs(teen, `update missions set hints_used = 3 where id = $1`, [mission])).toMatch(/frozen/);
    expect(await h.failsAs(teen, `update missions set gate2 = 'shown' where id = $1`, [mission])).toMatch(/engine only/);
    expect(await h.failsAs(teen, `select app.transition_mission($1,'reflected')`, [mission])).toMatch(/reflection required/);
    expect(await h.failsAs(stranger, `insert into reflections (mission_id, prompts_and_answers) values ($1,'[]')`, [mission])).toMatch(/row-level security/);
    await h.as(teen, (q) => q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[{"prompt":"س","answer":"ج"}]')`, [mission]));
    await h.as(teen, (q) => q(`select app.transition_mission($1,'reflected')`, [mission]));
    expect(await h.failsAs(teen, `select app.transition_mission($1,'in_progress')`, [mission])).toMatch(/not allowed/);
    expect(await h.as(guardian, async (q) => (await q(`select count(*)::int as n from reflections where mission_id = $1`, [mission])).rows[0].n)).toBe(1);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from missions`)).rows[0].n)).toBe(0);
  });
  it("التخلي يدخل التأمل، والاستبدال فقط للمقترحة", async () => {
    const m2 = await h.as(teen, async (q) => (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,'dc-sim-01',1,1,'L1_hint') returning id`, [teenProfile])).rows[0].id);
    await h.as(teen, (q) => q(`select app.transition_mission($1,'chosen')`, [m2]));
    expect(await h.failsAs(teen, `update missions set dismissed = true where id = $1`, [m2])).toMatch(/only suggested/);
    await h.as(teen, (q) => q(`select app.transition_mission($1,'planned')`, [m2]));
    await h.as(teen, (q) => q(`select app.transition_mission($1,'in_progress')`, [m2]));
    await h.as(teen, (q) => q(`select app.transition_mission($1,'abandoned')`, [m2]));
    const g = await h.service<{ gate1: boolean }>(`select gate1 from missions where id = $1`, [m2]);
    expect(g.rows[0]!.gate1).toBe(false);
    await h.as(teen, (q) => q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[{"prompt":"ما الذي أوقفك؟","answer":"تعبت"}]')`, [m2]));
    await h.as(teen, (q) => q(`select app.transition_mission($1,'reflected')`, [m2]));
    const m3 = await h.as(teen, async (q) => (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,'pr-sim-01',1,2,'L1_hint') returning id`, [teenProfile])).rows[0].id);
    await h.as(teen, (q) => q(`update missions set dismissed = true where id = $1`, [m3]));
  });
});
