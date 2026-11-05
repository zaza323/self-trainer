/**
 * المرحلة 3 على قاعدة بيانات حقيقية: خدمة اللعبة بعد reflected (عنصر تجميعي، XP، المرحلة، الكثافة، المساحة)،
 * العودة بعد انقطاع (XP + إنجاز)، "تلعب أقل" لا يُمنح لمن ترك، وRLS لقراءة الإنجازات.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { evaluateAndRecord } from "../../src/modules/evidence/service";
import { afterMissionReflected, evaluatePlayLess, getGameView, refreshGameState } from "../../src/modules/game/service";
import { game } from "../../src/shared/config";

const h = new RlsHarness();
let teen: TestUser, stranger: TestUser;
let teenProfile: string;
let admin: ReturnType<typeof pgSupabaseShim>;

async function runMission(templateId: string, opts: { distractions?: string[]; at?: Date } = {}) {
  const id = await h.as(teen, async (q) => (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,$2,1,2,'L1_hint') returning id`, [teenProfile, templateId])).rows[0].id);
  await h.as(teen, async (q) => {
    await q(`select app.transition_mission($1,'chosen')`, [id]);
    await q(`update missions set strategy_chosen = 's1', time_estimate = 5 where id = $1`, [id]);
    await q(`select app.transition_mission($1,'planned')`, [id]);
    await q(`select app.transition_mission($1,'in_progress')`, [id]);
    await q(`update missions set distraction_log = $2 where id = $1`, [id, JSON.stringify((opts.distractions ?? ["ignore", "ignore"]).map((c) => ({ at: "x", choice: c })))]);
    await q(`select app.transition_mission($1,'completed')`, [id]);
    await q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[{"prompt":"س","answer":"ج"}]')`, [id]);
    await q(`select app.transition_mission($1,'reflected')`, [id]);
  });
  if (opts.at) await h.service(`update mission_transitions set at = $2 where mission_id = $1`, [id, opts.at.toISOString()]);
  return id as string;
}

beforeAll(async () => {
  await h.setup();
  admin = pgSupabaseShim(h.pool);
  teen = await h.createUser("t3@test.local");
  stranger = await h.createUser("s3@test.local");
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','مراهق','teen') returning id`, [teen.id])).rows[0].id);
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));
});
afterAll(() => h.teardown());

describe("خدمة اللعبة بعد التأمل", () => {
  let m1: string;
  it("مهمة shown في المرحلة 1: عنصر تجميعي، XP، المرحلة 1 ثابتة، الكثافة من المعادلة، المساحة 1", async () => {
    m1 = await runMission("rd-sim-01");
    await evaluateAndRecord(admin, m1);
    const r = await afterMissionReflected(admin, m1);
    expect(r.collectible).toBe(true);
    expect(r.comeback).toBe(false);
    expect(r.stage).toBe(1);
    expect(r.intensity).toBe(Math.round(game.intensity.base_by_stage["1"] * game.intensity.age_factor.teen));
    expect(r.avatar_stage).toBe(1);
    const again = await afterMissionReflected(admin, m1);
    expect(again.collectible).toBe(false); // idempotent
    const view = await getGameView(admin, { id: teenProfile, age_mode: "teen", incentive_stage: 1, avatar_stage_max: 1 });
    expect(r.step_xp).toBeGreaterThan(0); // تعديل 0.3 §1: نقاط الخطوات قيد التدريب
    expect(view.xp).toBe(40 + r.step_xp); // نقاط النتائج (المثال 1) + نقاط الخطوات
    expect(view.collectibles).toHaveLength(1);
    expect(view.visible.has("collectibles_and_unlocks")).toBe(true);
    expect(view.visible.has("xp_number_and_level_bar")).toBe(true);
  });
  it("العودة بعد انقطاع ≥ 3 أيام: XP comeback مرة واحدة + إنجاز المستوى الأول", async () => {
    await h.service(`update mission_transitions set at = at - interval '10 days' where mission_id = $1`, [m1]);
    const m2 = await runMission("dc-sim-01");
    await evaluateAndRecord(admin, m2);
    const r = await afterMissionReflected(admin, m2);
    expect(r.comeback).toBe(true);
    expect(r.achievements).toContain("comeback");
    const again = await afterMissionReflected(admin, m2);
    expect(again.achievements).toEqual([]);
    const xp = await h.service<{ n: number }>(`select count(*)::int as n from xp_events where reason = 'comeback' and profile_id = $1`, [teenProfile]);
    expect(xp.rows[0]!.n).toBe(1);
    const earned = await h.as(teen, async (q) => (await q(`select a.code, pa.tier from profile_achievements pa join achievements a on a.id = pa.achievement_id where pa.profile_id = $1`, [teenProfile])).rows);
    expect(earned).toEqual([{ code: "comeback", tier: 1 }]);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from profile_achievements`)).rows[0].n)).toBe(0);
    expect(await h.failsAs(teen, `insert into profile_achievements (profile_id, achievement_id, tier) select $1, id, 9 from achievements limit 1`, [teenProfile])).toMatch(/row-level security|permission denied/);
  });
  it("لا تراجع للمساحة: avatar_stage_max يبقى الأعلى", async () => {
    await h.service(`update profiles set avatar_stage_max = 4 where id = $1`, [teenProfile]);
    const { data } = await admin.from("profiles").select("id, age_mode, incentive_stage, avatar_stage_max, onboarded_at, created_at").eq("id", teenProfile).single();
    const st = await refreshGameState(admin, data as never);
    expect(st.avatar_stage).toBe(4);
  });
  it("أ.11 اختبار 9 على القاعدة: صفر تقارير نقل → لا «تلعب أقل» حتى في المرحلة 3 مع نشاط منخفض", async () => {
    await h.service(`update profiles set incentive_stage = 3 where id = $1`, [teenProfile]);
    expect(await evaluatePlayLess(admin, teenProfile)).toBe(false);
    const n = await h.service<{ n: number }>(`select count(*)::int as n from profile_achievements pa join achievements a on a.id = pa.achievement_id where a.code = 'play_less' and pa.profile_id = $1`, [teenProfile]);
    expect(n.rows[0]!.n).toBe(0);
  });
  it("الكثافة 0 (تجاوز البالغ) تُخفي كل شيء في نموذج القراءة", async () => {
    const adultProfile = (await h.service<{ id: string }>(`select id from profiles where display_name = 'غريب'`)).rows[0]!.id;
    await h.service(`insert into settings (profile_id, key, value, set_by_role, set_by_user_id) values ($1,'game_intensity_override','0','player',$2)`, [adultProfile, stranger.id]);
    const view = await getGameView(admin, { id: adultProfile, age_mode: "adult", incentive_stage: 1, avatar_stage_max: 1 });
    expect(view.intensity).toBe(0);
    expect(view.visible.size).toBe(0);
  });
});
