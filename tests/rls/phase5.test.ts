/**
 * المرحلة 5 على قاعدة بيانات حقيقية — معيار القبول: مربٍ يضيف مهمة ومكافأة ويؤكد نقلًا ويرى أثرها؛ محفز ممنوع يُرفض؛
 * قفل في child يمنع الطفل من التعديل. + الموافقة على مهمة الطفل، الدعم المؤقت، سياق الحياة، الإنجازات الخاصة.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { createCustomTemplate, materializeSchedules, afterTransferReport, afterTransferConfirmed, afterObservation } from "../../src/modules/life/service";
import { evaluateRewardTriggers } from "../../src/modules/rewards/service";
import { evaluateAndRecord } from "../../src/modules/evidence/service";
import { customization, game } from "../../src/shared/config";

const h = new RlsHarness();
let creator: TestUser, childUser: TestUser, teen: TestUser, stranger: TestUser;
let childProfile: string, teenProfile: string;
let svc: ReturnType<typeof pgSupabaseShim>;

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  creator = await h.createUser("c5@test.local");
  childUser = await h.createUser("child5@child.local");
  teen = await h.createUser("t5@test.local");
  stranger = await h.createUser("s5@test.local");
  await h.as(creator, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','أم')`, [creator.id]));
  childProfile = (await h.service<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','kid5','mother','2026-11-05.1') as id`, [childUser.id, creator.id])).rows[0]!.id;
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','مراهق','teen') returning id`, [teen.id])).rows[0].id);
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));
});
afterAll(() => h.teardown());

describe("المربي يضيف مهمة واقعية (LIFE-3، MIS-10)", () => {
  it("قالب مخصص مملوك للطفل يراه المربي والطفل لا الغريب؛ المربي يدرج المهمة؛ الجدول المتكرر يُدرج يوميًا مرة واحدة", async () => {
    const tpl = await createCustomTemplate(svc, { profileId: childProfile, mode: "child", createdBy: creator.id, title: "ترتيب الحقيبة قبل النوم", situation: "كل مساء", mechanic: "plan_ahead", trainingLevel: "guided_real", minutes: 10 });
    expect(await h.as(creator, async (q) => (await q(`select count(*)::int as n from mission_templates where id = $1`, [tpl.id])).rows[0].n)).toBe(1);
    expect(await h.as(childUser, async (q) => (await q(`select count(*)::int as n from mission_templates where id = $1`, [tpl.id])).rows[0].n)).toBe(1);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from mission_templates where id = $1`, [tpl.id])).rows[0].n)).toBe(0);
    await h.as(creator, (q) => q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, source, created_by) values ($1,$2,1,2,'L0_instruct','guardian',$3)`, [childProfile, tpl.id, creator.id]));
    expect(await h.failsAs(stranger, `insert into missions (profile_id, template_id, template_version, difficulty, support_level, source) values ($1,$2,1,2,'L0_instruct','guardian')`, [childProfile, tpl.id])).toMatch(/row-level security/);
    await h.as(creator, (q) => q(`insert into mission_schedules (profile_id, created_by, template_id, template_version, days_of_week, time_local) values ($1,$2,$3,1,'{0,1,2,3,4,5,6}','19:00')`, [childProfile, creator.id, tpl.id]));
    expect(await materializeSchedules(svc, childProfile, "2026-11-06", 5)).toBe(1);
    expect(await materializeSchedules(svc, childProfile, "2026-11-06", 5)).toBe(0);
    const n = await h.service<{ n: number }>(`select count(*)::int as n from missions where profile_id = $1 and source = 'guardian_recurring'`, [childProfile]);
    expect(n.rows[0]!.n).toBe(1);
  });
  it("MIS-2: مهمة يكتبها الطفل تنتظر الموافقة ولا تُختار قبلها؛ المربي يوافق عبر RPC", async () => {
    const tpl = await createCustomTemplate(svc, { profileId: childProfile, mode: "child", createdBy: childUser.id, title: "أرتب ألعابي", situation: "", mechanic: "decompose", trainingLevel: "independent_real" });
    const mid = await h.as(childUser, async (q) => (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, source, needs_approval) values ($1,$2,1,2,'L0_instruct','self',true) returning id`, [childProfile, tpl.id])).rows[0].id);
    expect(await h.failsAs(childUser, `select app.transition_mission($1,'chosen')`, [mid])).toMatch(/awaits guardian approval/);
    expect(await h.failsAs(stranger, `select app.approve_mission($1)`, [mid])).toMatch(/not allowed|not pending/);
    await h.as(creator, (q) => q(`select app.approve_mission($1)`, [mid]));
    await h.as(childUser, (q) => q(`select app.transition_mission($1,'chosen')`, [mid]));
    const notif = await h.service<{ n: number }>(`select count(*)::int as n from notifications where profile_id = $1 and type = 'mission_approved'`, [childProfile]);
    expect(notif.rows[0]!.n).toBe(1);
  });
});


// 0017: لا كتابة مباشرة على rewards؛ الإنشاء وتغيير الحالة عبر دالتين لدور الخدمة (كما يفعل فعل الخادم بهوية الجلسة)
const rewardCreate = (actor: TestUser, profile: string, title: string, type: string, params: string | null, status = "draft") =>
  h.service<{ id: string }>(`select public.reward_create($1,$2,$3,null,null,$4,$5::jsonb,$6) as id`, [actor.id, profile, title, type, params, status]).then((r) => r.rows[0]!.id);
const rewardTo = (actor: TestUser, id: string, to: string) => h.service(`select * from public.reward_transition($1,$2,$3)`, [actor.id, id, to]);
const fails = async (p: Promise<unknown>): Promise<string | null> => { try { await p; return null; } catch (e) { return (e as Error).message; } };
describe("المكافآت الواقعية (REWARD-1..8)", () => {
  it("محفز ممنوع يُرفض في قاعدة البيانات برسالة تشرح السبب (REWARD-2)", async () => {
    for (const f of customization.real_rewards.forbidden_triggers) {
      const err = await fails(rewardCreate(creator, childProfile, "نزهة", f, '{"count":5}'));
      expect(err).toMatch(/forbidden_trigger/);
      expect(err).toMatch(/التعلم/);
    }
    expect(await fails(rewardCreate(creator, childProfile, "x", "gate2_shown_count", '{"capability_id":"attention","count":1}'))).toMatch(/invalid_params: count/);
    expect(await fails(rewardCreate(stranger, childProfile, "x", "gate2_shown_count", '{"capability_id":"attention","count":2}'))).toMatch(/not_permitted/);
    expect(await fails(rewardCreate(childUser, childProfile, "x", "gate2_shown_count", '{"capability_id":"attention","count":2}'))).toMatch(/not_permitted/);
  });
  let rewardId: string;
  it("الدورة: draft → active (عهد معلن) → earned عند تحقق المحفز منذ التفعيل فقط → delivered → acknowledged، مع تسجيل كل انتقال", async () => {
    rewardId = await rewardCreate(creator, childProfile, "نزهة الجمعة", "gate2_shown_count", '{"capability_id":"attention","count":2}');
    expect(await h.as(childUser, async (q) => (await q(`select count(*)::int as n from rewards where id = $1`, [rewardId])).rows[0].n)).toBe(0); // المسودة لا تظهر للمتدرب
    await rewardTo(creator, rewardId, "active");
    expect(await h.as(childUser, async (q) => (await q(`select status from rewards where id = $1`, [rewardId])).rows[0].status)).toBe("active");
    expect(await fails(rewardTo(creator, rewardId, "delivered"))).toMatch(/not allowed/);
    // مهمتان shown للانتباه بعد التفعيل
    for (let i = 0; i < 2; i++) {
      const mid = await h.as(childUser, async (q) => (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,'rd-sim-01',1,2,'L0_instruct') returning id`, [childProfile])).rows[0].id);
      await h.as(childUser, async (q) => {
        await q(`select app.transition_mission($1,'chosen')`, [mid]); await q(`update missions set strategy_chosen = 's1', time_estimate = 5 where id = $1`, [mid]);
        await q(`select app.transition_mission($1,'planned')`, [mid]); await q(`select app.transition_mission($1,'in_progress')`, [mid]);
        await q(`update missions set distraction_log = '[{"at":"x","choice":"ignore"},{"at":"y","choice":"ignore"}]' where id = $1`, [mid]);
        await q(`select app.transition_mission($1,'completed')`, [mid]);
        await q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[{"prompt":"س","answer":"ج"}]')`, [mid]);
        await q(`select app.transition_mission($1,'reflected')`, [mid]);
      });
      await evaluateAndRecord(svc, mid);
      const r = await evaluateRewardTriggers(svc, childProfile);
      if (i === 0) expect(r.earned).toEqual([]);
      else expect(r.earned).toEqual([rewardId]);
    }
    expect(await h.service<{ status: string }>(`select status from rewards where id = $1`, [rewardId]).then((r) => r.rows[0]!.status)).toBe("earned");
    expect((await h.service<{ n: number }>(`select count(*)::int as n from notifications where type in ('reward_earned','reward_earned_guardian') and profile_id = $1`, [childProfile])).rows[0]!.n).toBe(2);
    expect(await fails(rewardTo(creator, rewardId, "cancelled"))).toMatch(/not allowed/); // العهد لا يُلغى بعد earned
    expect(await fails(rewardTo(childUser, rewardId, "delivered"))).toMatch(/not allowed/); // المتدرب لا يسلّم
    await rewardTo(creator, rewardId, "delivered");
    await rewardTo(childUser, rewardId, "acknowledged");
    const ev = await h.service<{ to_status: string }>(`select to_status from reward_events where reward_id = $1 order by at`, [rewardId]);
    expect(ev.rows.map((e) => e.to_status)).toEqual(["draft", "active", "earned", "delivered", "acknowledged"]);
  });
  it("المفاجأة تُنشأ earned مباشرة؛ حد 10 عهود نشطة", async () => {
    const sid = await rewardCreate(creator, childProfile, "آيس كريم", "surprise", null);
    const st = (await h.service<{ status: string }>(`select status from rewards where id = $1`, [sid])).rows[0]!.status;
    expect(st).toBe("earned");
    for (let i = 0; i < customization.real_rewards.max_active_per_player; i++) {
      await rewardCreate(creator, childProfile, `عهد ${i}`, "transfer_reports", '{"count":3}', "active");
    }
    expect(await fails(rewardCreate(creator, childProfile, "زيادة", "transfer_reports", '{"count":3}', "active"))).toMatch(/max_active_rewards_reached/);
  });
  it("البالغ ينشئ مكافأة لنفسه؛ المراهق لا", async () => {
    const adultProfile = (await h.service<{ id: string }>(`select id from profiles where display_name = 'غريب'`)).rows[0]!.id;
    await rewardCreate(stranger, adultProfile, "كتاب", "transfer_reports", '{"count":2}', "active");
    expect(await fails(rewardCreate(teen, teenProfile, "x", "transfer_reports", '{"count":2}'))).toMatch(/not_permitted/);
  });
  it("إنجاز خاص (GAME-10): المحفزات نفسها عدا surprise", async () => {
    expect(await h.failsAs(creator, `insert into achievements (code, name_by_mode, owner_profile_id, created_by, trigger_type) values ('custom-x','{"child":"x"}',$1,$2,'surprise')`, [childProfile, creator.id])).toMatch(/surprise_not_allowed/);
    expect(await h.failsAs(creator, `insert into achievements (code, name_by_mode, owner_profile_id, created_by, trigger_type, trigger_params) values ('custom-y','{"child":"x"}',$1,$2,'streak_days','{"count":7}')`, [childProfile, creator.id])).toMatch(/forbidden_trigger/);
    await h.as(creator, (q) => q(`insert into achievements (code, name_by_mode, owner_profile_id, created_by, trigger_type, trigger_params) values ('custom-z','{"child":"بطل الانتباه"}',$1,$2,'gate2_shown_count','{"capability_id":"attention","count":2}')`, [childProfile, creator.id]));
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from achievements where code = 'custom-z'`)).rows[0].n)).toBe(0);
  });
});

describe("تقارير النقل (LIFE-2) وتأكيد المربي", () => {
  it("المتدرب يبلّغ؛ المربي يؤكد ويرى الأثر: دليلان (self ثم guardian) وXP", async () => {
    const rid = await h.as(childUser, async (q) => (await q(`insert into transfer_reports (profile_id, capability_id, context_tag, what, worked) values ($1,'attention','study','ركزت في الحصة رغم الضجيج',true) returning id`, [childProfile])).rows[0].id);
    await afterTransferReport(svc, { id: rid, profile_id: childProfile, mission_id: null, capability_id: "attention", context_tag: "study", worked: true });
    expect(await h.as(stranger, async (q) => (await q(`update transfer_reports set guardian_confirmed = true where id = $1`, [rid])).rowCount)).toBe(0);
    await h.as(creator, (q) => q(`update transfer_reports set guardian_confirmed = true, confirmed_by = $2, confirmed_at = now() where id = $1`, [rid, creator.id]));
    await afterTransferConfirmed(svc, { id: rid, profile_id: childProfile, capability_id: "attention", context_tag: "study", worked: true });
    const ev = await h.service<{ source: string; weight: number }>(`select source, weight from evidence_events where profile_id = $1 and type = 'transfer_report' order by created_at`, [childProfile]);
    expect(ev.rows.map((e) => e.source)).toEqual(["self", "guardian"]);
    expect(Number(ev.rows[1]!.weight)).toBeGreaterThan(Number(ev.rows[0]!.weight));
    const xp = await h.service<{ reason: string; amount: number }>(`select reason, amount from xp_events where source_id = $1::text order by created_at`, [rid]);
    expect(xp.rows.map((x) => [x.reason, x.amount])).toEqual([["transfer_report", game.xp.rewards.transfer_report], ["transfer_guardian_confirmed", game.xp.rewards.transfer_guardian_confirmed]]);
    // الغريب لا يُبلّغ عن غيره
    expect(await h.failsAs(stranger, `insert into transfer_reports (profile_id, capability_id, context_tag, what, worked) values ($1,'attention','study','x',true)`, [childProfile])).toMatch(/row-level security/);
  });
});

describe("ملاحظات المربي والدعم المؤقت وسياق الحياة", () => {
  it("GUARD-3: ملاحظة بصيغة محددة → دليل بوزن المربي خارج المهام", async () => {
    const oid = await h.as(creator, async (q) => (await q(`insert into guardian_observations (guardian_id, profile_id, capability_id, observation_type, context_tag) values ($1,$2,'autonomy','started_without_reminder','home') returning id`, [creator.id, childProfile])).rows[0].id);
    await afterObservation(svc, { id: oid, profile_id: childProfile, capability_id: "autonomy", observation_type: "started_without_reminder", context_tag: "home" });
    const ev = await h.service<{ source: string; value: number; mission_id: string | null }>(`select source, value, mission_id from evidence_events where profile_id = $1 and type = 'guardian_observation'`, [childProfile]);
    expect(ev.rows[0]).toMatchObject({ source: "guardian", mission_id: null });
    expect(Number(ev.rows[0]!.value)).toBeGreaterThan(0);
    expect(await h.failsAs(stranger, `insert into guardian_observations (guardian_id, profile_id, capability_id, observation_type) values ($1,$2,'autonomy','started_without_reminder')`, [stranger.id, childProfile])).toMatch(/row-level security/);
  });
  it("GUARD-9: دعم أكثر يخفض درجة واحدة مؤقتًا ولا يرفع أبدًا؛ manage_settings مطلوبة", async () => {
    await h.service(`update capability_states set support_level = 'L2_ask' where profile_id = $1 and capability_id = 'planning'`, [childProfile]);
    const r = await h.as(creator, async (q) => (await q(`select app.request_more_support($1,'planning') as v`, [childProfile])).rows[0].v);
    expect(r.level).toBe("L1_hint");
    expect(new Date(r.until).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    expect(await h.failsAs(stranger, `select app.request_more_support($1,'planning')`, [childProfile])).toMatch(/not allowed/);
    await h.service(`update capability_states set support_level = 'L0_instruct' where profile_id = $1 and capability_id = 'planning'`, [childProfile]);
    expect((await h.as(creator, async (q) => (await q(`select app.request_more_support($1,'planning') as v`, [childProfile])).rows[0].v)).level).toBe("L0_instruct");
  });
  it("ADAPT-1: الطفل والمربي في child يكتبان السياق؛ المراهق يكتب سياقه؛ الغريب لا يقرأ ولا يكتب", async () => {
    await h.as(childUser, (q) => q(`insert into personal_context (profile_id, interests, updated_by) values ($1,'["كرة"]',$2)`, [childProfile, childUser.id]));
    await h.as(creator, (q) => q(`update personal_context set interests = '["كرة القدم"]', updated_by = $2 where profile_id = $1`, [childProfile, creator.id]));
    expect(await h.failsAs(stranger, `insert into personal_context (profile_id, interests) values ($1,'["x"]')`, [teenProfile])).toMatch(/row-level security/);
    expect(await h.as(childUser, async (q) => (await q(`select interests from personal_context where profile_id = $1`, [childProfile])).rows[0].interests)).toEqual(["كرة القدم"]);
    await h.as(teen, (q) => q(`insert into personal_context (profile_id, contexts, updated_by) values ($1,'["الدراسة","النادي"]',$2)`, [teenProfile, teen.id]));
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from personal_context`)).rows[0].n)).toBe(0);
  });
  it("قفل في child يمنع الطفل من التعديل (معيار القبول)", async () => {
    await h.as(creator, (q) => q(`insert into settings (profile_id, key, value, set_by_role, locked) values ($1,'space_theme','"room"','guardian',true)`, [childProfile]));
    expect(await h.failsAs(childUser, `insert into settings (profile_id, key, value, set_by_role) values ($1,'space_theme','"garden"','player')`, [childProfile])).toMatch(/row-level security/);
  });
});
