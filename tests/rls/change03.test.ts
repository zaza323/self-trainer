/**
 * تعديل 0.3 على قاعدة بيانات حقيقية — القسم 6: (1) L3 → صفر نقاط خطوات ونقاط النتائج كما هي؛ (2) تكافؤ: مستوى تدريب مختلف أو فرق دعم > 1 → رفض؛
 * (4) إعادة الحساب تعطي المفاجآت نفسها حرفيًا؛ (6) child بلا موافقة مربٍ → لا يدخل أي تحدٍّ. (+ الانسحاب بلا عقوبة، RLS اللوحة للمشاركين فقط.)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { evaluateAndRecord } from "../../src/modules/evidence/service";
import { afterMissionReflected, maybeSurprise } from "../../src/modules/game/service";
import { rollSurprise } from "../../src/modules/game/surprises";
import { recomputeChallengeScores } from "../../src/modules/challenges/service";
import { game } from "../../src/shared/config";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = new RlsHarness();
let t1: TestUser, t2: TestUser, t3: TestUser, t4: TestUser, guardian: TestUser, childUser: TestUser, stranger: TestUser;
let p1: string, p2: string, p3: string, p4: string, childProfile: string;
let svc: SupabaseClient;
const TEMPLATE = "rd-sim-01"; // القدرة الأساسية: attention

async function runMission(user: TestUser, profile: string, opts: { id?: string; resume?: boolean; distractions?: string[] } = {}) {
  return h.as(user, async (q) => {
    const id = (await q(`insert into missions (${opts.id ? "id, " : ""}profile_id, template_id, template_version, difficulty, support_level) values (${opts.id ? "$3, " : ""}$1,$2,1,2,'L1_hint') returning id`, opts.id ? [profile, TEMPLATE, opts.id] : [profile, TEMPLATE])).rows[0].id as string;
    await q(`select app.transition_mission($1,'chosen')`, [id]);
    await q(`update missions set strategy_chosen = 's1', time_estimate = 5, prediction = $2 where id = $1`, [id, JSON.stringify({ minutes: 5 })]);
    await q(`select app.transition_mission($1,'planned')`, [id]);
    await q(`select app.transition_mission($1,'in_progress')`, [id]);
    if (opts.resume) { await q(`select app.transition_mission($1,'interrupted')`, [id]); await q(`update missions set interruption_reasons = '[{"at":"x","reason":"r"}]' where id = $1`, [id]); await q(`select app.transition_mission($1,'in_progress')`, [id]); }
    if (opts.distractions) await q(`update missions set distraction_log = $2 where id = $1`, [id, JSON.stringify(opts.distractions.map((c) => ({ at: "x", choice: c })))]);
    await q(`select app.transition_mission($1,'completed')`, [id]);
    await q(`insert into reflections (mission_id, prompts_and_answers) values ($1, '[{"prompt":"س","answer":"ج"}]')`, [id]);
    await q(`select app.transition_mission($1,'reflected')`, [id]);
    return id;
  });
}
const xpByPrefix = async (mission: string, like: string) => (await h.service<{ x: number }>(`select coalesce(sum(amount),0)::int as x from xp_events where source_id like $1 and reason like $2`, [`${mission}%`, like])).rows[0]!.x;

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  const users = await Promise.all(["t1", "t2", "t3", "t4", "g", "child", "s"].map((n) => h.createUser(`${n}c3@test.local`)));
  [t1, t2, t3, t4, guardian, childUser, stranger] = users as [TestUser, TestUser, TestUser, TestUser, TestUser, TestUser, TestUser];
  const mk = (u: TestUser, name: string) => h.as(u, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player',$2,'teen') returning id`, [u.id, name])).rows[0].id as string);
  [p1, p2, p3, p4] = await Promise.all([mk(t1, "أحمد"), mk(t2, "سارة"), mk(t3, "ليث"), mk(t4, "نور")]);
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','teen')`, [stranger.id]));
  await h.as(guardian, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','أم')`, [guardian.id]));
  childProfile = (await h.service<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','kidc3','mother','2026-11-05.1') as id`, [childUser.id, guardian.id])).rows[0]!.id;
  // الكثافة كافية للتحديات (تُحسب عادة بعد التقييم؛ هنا تُضبط مباشرة)
  await h.service(`update profiles set game_intensity = $1 where kind = 'player'`, [game.challenges.min_intensity + 10]);
  await h.service(`update settings_catalog set defaults = jsonb_set(defaults, '{child}', 'true') where key = 'challenges_enabled'`); // للاختبار 6 (الطفل يصل للانضمام ويُعلَّق)
});
afterAll(() => h.teardown());

describe("§1 نقاط الخطوات (اختبار 1)", () => {
  it("قدرة دعمها L3 → صفر نقاط خطوات، ونقاط النتائج كما هي؛ وقيد التدريب تُمنح مرة واحدة", async () => {
    await h.service(`update capability_states set support_level = 'L3_free' where profile_id = $1 and capability_id = 'attention'`, [p1]);
    // معرّف محدد لا يصيب مفاجأة: حتى لا تُستهلك حصة اليوم (واحدة) بالصدفة قبل اختبار المفاجآت أدناه (كان يفشل عشوائيًا بنسبة احتمال المرحلة 1).
    const missId = Array(1000).fill(0).map((_, i) => `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`).find((id) => !rollSurprise({ missionId: id, stage: 1, intensity: 50, enabled: true, todayCount: 0, weekCount: 0, mode: "teen" }))!;
    const m = await runMission(t1, p1, { id: missId, resume: true, distractions: ["ignore", "break_return", "give_in"] });
    const r = await evaluateAndRecord(svc, m);
    const g = await afterMissionReflected(svc, m);
    expect(r.xp).toBeGreaterThan(0);                    // نقاط النتائج كما هي
    expect(g.step_xp).toBe(0);
    expect(await xpByPrefix(m, "step_%")).toBe(0);
    const m2 = await runMission(t2, p2, { resume: true, distractions: ["ignore", "break_return", "give_in"] });
    await evaluateAndRecord(svc, m2);
    const g2 = await afterMissionReflected(svc, m2);
    const s = game.xp.step_rewards;
    expect(g2.step_xp).toBe(s.step_planned + s.step_prediction + s.step_resumed + s.step_distraction_handled.per_event * s.step_distraction_handled.max_per_mission);
    await afterMissionReflected(svc, m2); // idempotent
    expect(await xpByPrefix(m2, "step_%")).toBe(g2.step_xp);
  });
});

describe("§2 التحديات العادلة (اختبارات 2 و6)", () => {
  let cid: string, code: string;
  it("teen ينشئ تحديًا ويكون أول مشارك؛ متدرب متكافئ ينضم بالرمز", async () => {
    cid = await h.as(t2, async (q) => (await q(`select app.create_challenge($1,$2,1) as id`, [p2, TEMPLATE])).rows[0].id);
    code = (await h.service<{ invite_code: string }>(`select invite_code from challenges where id = $1`, [cid])).rows[0]!.invite_code;
    expect(await h.as(t4, async (q) => (await q(`select app.join_challenge_by_code($1,$2) as r`, [p4, code])).rows[0].r)).toBe("joined");
    expect((await h.service<{ status: string }>(`select status from challenges where id = $1`, [cid])).rows[0]!.status).toBe("active");
  });
  it("اختبار 2: مستوى تدريب مختلف → مرفوض؛ فرق دعم > 1 → مرفوض؛ نفس الوضع العمري شرط", async () => {
    await h.service(`update capability_states set training_level = 'guided_real' where profile_id = $1 and capability_id = 'attention'`, [p3]);
    expect(await h.failsAs(t3, `select app.join_challenge_by_code($1,$2)`, [p3, code])).toMatch(/training_level/);
    await h.service(`update capability_states set training_level = 'simulated', support_level = 'L3_free' where profile_id = $1 and capability_id = 'attention'`, [p3]);
    expect(await h.failsAs(t3, `select app.join_challenge_by_code($1,$2)`, [p3, code])).toMatch(/support_gap/); // L1 ↔ L3 = 2
    await h.service(`update capability_states set support_level = 'L2_ask' where profile_id = $1 and capability_id = 'attention'`, [p3]);
    expect(await h.as(t3, async (q) => (await q(`select app.join_challenge_by_code($1,$2) as r`, [p3, code])).rows[0].r)).toBe("joined"); // فرق 1 مسموح
    expect(await h.failsAs(t3, `select app.join_challenge_by_code($1,$2)`, [p3, code])).toMatch(/already/);
    expect(await h.failsAs(stranger, `select app.join_challenge_by_code($1,'ZZZZZZ')`, [p2])).toMatch(/not allowed|not_found/);
  });
  it("اختبار 6: child بلا موافقة مربٍ → لا يدخل أي تحدٍّ (طلب معلق لا يُحتسب)، ولا ينشئ؛ المربي يوافق فيدخل", async () => {
    expect(await h.failsAs(childUser, `select app.create_challenge($1,$2,1)`, [childProfile, TEMPLATE])).toMatch(/child_invite_only/);
    await h.service(`update profiles set age_mode = 'teen' where id = $1`, [childProfile]); // نفس الوضع العمري للتحدي (اختبار الموافقة لا الوضع)
    await h.service(`update capability_states set support_level = 'L1_hint' where profile_id = $1 and capability_id = 'attention'`, [childProfile]);
    await h.service(`update profiles set age_mode = 'child' where id = $1`, [childProfile]);
    // تحدٍّ للأطفال: ننشئ تحديًا بوضع child عبر الخدمة
    const kidCh = (await h.service<{ id: string }>(`insert into challenges (template_id, template_version, difficulty, capability_id, training_level, age_mode, ends_at, join_until, created_by, invite_code) values ($1,1,2,'attention','simulated','child', now() + interval '7 days', now() + interval '48 hours', $2, 'KID001') returning id`, [TEMPLATE, guardian.id])).rows[0]!.id;
    expect(await h.as(childUser, async (q) => (await q(`select app.join_challenge_by_code($1,'KID001') as r`, [childProfile])).rows[0].r)).toBe("pending");
    expect((await h.service<{ m: boolean }>(`select app.challenge_member($1,$2) as m`, [kidCh, childProfile])).rows[0]!.m).toBe(false);
    expect(await recomputeChallengeScores(svc, kidCh)).toBe(0); // لا يُحتسب
    expect(await h.failsAs(stranger, `select app.approve_challenge_participant($1,$2)`, [kidCh, childProfile])).toMatch(/not allowed/);
    await h.as(guardian, (q) => q(`select app.approve_challenge_participant($1,$2)`, [kidCh, childProfile]));
    expect((await h.service<{ m: boolean }>(`select app.challenge_member($1,$2) as m`, [kidCh, childProfile])).rows[0]!.m).toBe(true);
  });
  it("اللوحة للمشاركين فقط؛ النقاط من الأدلة؛ الانسحاب بلا خصم", async () => {
    const m = await runMission(t4, p4);
    await evaluateAndRecord(svc, m);
    await afterMissionReflected(svc, m);
    expect(await recomputeChallengeScores(svc, cid)).toBe(3);
    const sc = await h.as(t4, async (q) => (await q(`select profile_id, attempts_pts, rank from challenge_scores where challenge_id = $1 order by rank`, [cid])).rows);
    expect(sc.length).toBe(3);
    expect(sc[0]).toMatchObject({ profile_id: p4, attempts_pts: game.challenges.scoring.attempts_per_reflected, rank: 1 });
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from challenge_scores where challenge_id = $1`, [cid])).rows[0].n)).toBe(0);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from challenges where id = $1`, [cid])).rows[0].n)).toBe(0);
    await h.as(t3, (q) => q(`select app.leave_challenge($1,$2)`, [p3, cid]));
    const before = (await h.service<{ x: number }>(`select coalesce(sum(amount),0)::int as x from xp_events where profile_id = $1`, [p3])).rows[0]!.x;
    expect(await recomputeChallengeScores(svc, cid)).toBe(2);
    expect((await h.service<{ x: number }>(`select coalesce(sum(amount),0)::int as x from xp_events where profile_id = $1`, [p3])).rows[0]!.x).toBe(before);
  });
});

describe("§3 المفاجآت (اختبار 4)", () => {
  it("إعادة الحساب تعطي المفاجأة نفسها حرفيًا؛ صف واحد (UNIQUE)؛ الحد اليومي", async () => {
    const hitId = Array(1000).fill(0).map((_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`).find((id) => rollSurprise({ missionId: id, stage: 1, intensity: 50, enabled: true, todayCount: 0, weekCount: 0, mode: "teen" }))!;
    expect(hitId).toBeTruthy();
    const m = await runMission(t1, p1, { id: hitId });
    await evaluateAndRecord(svc, m);
    const g = await afterMissionReflected(svc, m);
    expect(g.surprise).not.toBeNull();
    const again = await maybeSurprise(svc, { id: m, profile_id: p1 }, { age_mode: "teen", incentive_stage: 1 }, 50);
    expect(again).toEqual(g.surprise);
    const rows = await h.service<{ kind: string; payload: unknown }>(`select kind, payload from surprise_events where mission_id = $1`, [m]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.kind).toBe(g.surprise!.kind);
    expect(await h.failsAs(t1, `delete from surprise_events where mission_id = $1`, [m])).not.toBeNull(); // append-only
    // مفاجأة ثانية في اليوم نفسه لا تُمنح (الحد 1 يوميًا)
    const hit2 = Array(1000).fill(0).map((_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`).find((id) => rollSurprise({ missionId: id, stage: 1, intensity: 50, enabled: true, todayCount: 0, weekCount: 0, mode: "teen" }))!;
    const m2 = await runMission(t1, p1, { id: hit2 });
    await evaluateAndRecord(svc, m2);
    expect((await afterMissionReflected(svc, m2)).surprise).toBeNull();
  });
});
