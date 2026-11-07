/**
 * المرحلة 6 على قاعدة بيانات حقيقية — معيار القبول: إكمال مهمة وتأمل دون اتصال يُزامَن بلا تكرار أدلة.
 * + وقت الحدث من العميل، RLS اشتراكات الدفع ورؤية المربي للإشعارات، المخطط (dedupe)، الحد اليومي وساعات الهدوء، تجاوز الأمان، الاحتفاظ.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { applyClientOps, clampClientAt } from "../../src/modules/sync/service";
import { planForProfile, deliverDue, runRetention } from "../../src/modules/notifications/service";
import { fakeSender } from "../../src/modules/notifications/sender";
import { instantForLocal } from "../../src/modules/notifications/plan";
import { loadTemplatesFromContent } from "../../src/modules/library/content";
import { limits } from "../../src/shared/config";
import type { MissionRow } from "../../src/modules/missions/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = new RlsHarness();
let teen: TestUser, stranger: TestUser, guardian: TestUser, n6: TestUser;
let teenProfile: string, strangerProfile: string, n6Profile: string;
let svc: SupabaseClient, teenDb: SupabaseClient;
const templates = loadTemplatesFromContent();
const TZ = "Asia/Amman";
const TEMPLATE = "rd-sim-01"; // completion_check = timer

const loadMission = async (id: string) => {
  const { data } = await svc.from("missions").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const template = templates.find((t) => t.id === (data as MissionRow).template_id)!;
  return { mission: data as MissionRow, template };
};

async function startMission(user: TestUser, profile: string) {
  return h.as(user, async (q) => {
    const id = (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,$2,1,2,'L1_hint') returning id`, [profile, TEMPLATE])).rows[0].id as string;
    await q(`select app.transition_mission($1,'chosen')`, [id]);
    await q(`update missions set strategy_chosen = 's1', time_estimate = 5, prediction = $2 where id = $1`, [id, JSON.stringify({ minutes: 5 })]);
    await q(`select app.transition_mission($1,'planned')`, [id]);
    await q(`select app.transition_mission($1,'in_progress')`, [id]);
    await q(`update missions set started_at = now() - interval '30 minutes' where id = $1`, [id]);
    return id;
  });
}
const counts = async (profile: string, mission: string) => {
  const ev = await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where mission_id = $1`, [mission]);
  const xp = await h.service<{ n: number }>(`select count(*)::int as n from xp_events where profile_id = $1`, [profile]);
  const rf = await h.service<{ n: number }>(`select count(*)::int as n from reflections where mission_id = $1`, [mission]);
  const tr = await h.service<{ n: number }>(`select count(*)::int as n from mission_transitions where mission_id = $1`, [mission]);
  const st = await h.service<{ status: string; completed_at: string }>(`select status, completed_at from missions where id = $1`, [mission]);
  return { evidence: ev.rows[0]!.n, xp: xp.rows[0]!.n, reflections: rf.rows[0]!.n, transitions: tr.rows[0]!.n, status: st.rows[0]!.status, completed_at: st.rows[0]!.completed_at };
};

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  teen = await h.createUser("t6@test.local");
  stranger = await h.createUser("s6@test.local");
  guardian = await h.createUser("g6@test.local");
  n6 = await h.createUser("n6@test.local");
  teenDb = pgSupabaseShim(h.pool, teen);
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','مراهق','teen',$2) returning id`, [teen.id, TZ])).rows[0].id);
  strangerProfile = await h.as(stranger, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult') returning id`, [stranger.id])).rows[0].id);
  n6Profile = await h.as(n6, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','نور','teen',$2) returning id`, [n6.id, TZ])).rows[0].id);
  await h.as(guardian, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','مربٍ')`, [guardian.id]));
});
afterAll(() => h.teardown());

describe("معيار القبول: إكمال وتأمل دون اتصال يُزامَن بلا تكرار", () => {
  const deps = () => ({ db: teenDb, admin: () => svc, profileId: teenProfile, mode: "teen" as const, loadMission });
  let mid: string;
  const ops = () => [
    { id: "11111111-1111-4111-8111-111111111111", kind: "complete" as const, mission_id: mid, payload: {}, client_at: new Date(Date.now() - 5 * 60000).toISOString() },
    { id: "22222222-2222-4222-8222-222222222222", kind: "reflect" as const, mission_id: mid, payload: { prompts: ["ما الذي ساعدك؟", "ماذا تغيّر؟"], answers: ["التخطيط المسبق", "صرت أبدأ أسرع"] }, client_at: new Date(Date.now() - 3 * 60000).toISOString() },
  ];
  it("الدفعة تُطبَّق مرة: الحالة reflected، أدلة وXP وتأمل واحد، وcompleted_at = وقت الجهاز", async () => {
    mid = await startMission(teen, teenProfile);
    const r = await applyClientOps(deps(), ops());
    expect(r.map((x) => [x.ok, x.replayed])).toEqual([[true, false], [true, false]]);
    const c = await counts(teenProfile, mid);
    expect(c.status).toBe("reflected");
    expect(c.evidence).toBeGreaterThan(0);
    expect(c.xp).toBeGreaterThan(0);
    expect(c.reflections).toBe(1);
    expect(Math.abs(Date.parse(c.completed_at) - Date.parse(ops()[0]!.client_at))).toBeLessThan(2000);
    const log = await h.service<{ n: number }>(`select count(*)::int as n from client_ops where profile_id = $1 and applied_at is not null and (result->>'ok')::boolean`, [teenProfile]);
    expect(log.rows[0]!.n).toBe(2);
  });
  it("إعادة إرسال الدفعة نفسها (المفاتيح نفسها) → replayed بلا أي تكرار", async () => {
    const before = await counts(teenProfile, mid);
    const r = await applyClientOps(deps(), ops());
    expect(r.map((x) => [x.ok, x.replayed])).toEqual([[true, true], [true, true]]);
    expect(await counts(teenProfile, mid)).toEqual(before);
  });
  it("عملية مكررة بمفتاح جديد تُرفض بالحالة (bad_state) ولا تكرر الأدلة", async () => {
    const before = await counts(teenProfile, mid);
    const r = await applyClientOps(deps(), ops().map((o, i) => ({ ...o, id: `3333333${i}-3333-4333-8333-333333333333` })));
    expect(r.every((x) => !x.ok && x.error === "bad_state")).toBe(true);
    expect(await counts(teenProfile, mid)).toEqual(before);
  });
  it("مستخدم آخر لا يستطيع تطبيق عملية على مهمة ليست له", async () => {
    const m2 = await startMission(teen, teenProfile);
    const r = await applyClientOps({ ...deps(), db: pgSupabaseShim(h.pool, stranger), profileId: strangerProfile }, [{ id: "44444444-4444-4444-8444-444444444444", kind: "complete", mission_id: m2, payload: {}, client_at: new Date().toISOString() }]);
    expect(r[0]).toMatchObject({ ok: false, error: "not_allowed" });
    expect((await counts(teenProfile, m2)).status).toBe("in_progress");
  });
  it("وقت العميل يُقصّ: لا مستقبل ولا أقدم من الحد", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(clampClientAt("2026-11-06T12:00:00Z", now)).toBe(now.toISOString());
    expect(clampClientAt("2020-01-01T00:00:00Z", now)).toBe(new Date(now.getTime() - limits.offline.client_at_max_age_days * 86400000).toISOString());
    expect(clampClientAt("2026-11-05T11:00:00Z", now)).toBe("2026-11-05T11:00:00.000Z");
  });
});

describe("Web Push والإشعارات (NOTIF-1..5)", () => {
  it("RLS: اشتراك الدفع لصاحبه فقط؛ المربي يرى إشعارًا موجهًا إليه بـ payload.guardian_id", async () => {
    await h.as(teen, (q) => q(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1,'https://push.example/teen','k','a')`, [teen.id]));
    expect(await h.failsAs(stranger, `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1,'https://push.example/x','k','a')`, [teen.id])).toMatch(/row-level security/);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from push_subscriptions`)).rows[0].n)).toBe(0);
    await h.service(`insert into notifications (profile_id, type, payload) values ($1,'reward_earned_guardian', $2)`, [teenProfile, { guardian_id: guardian.id, title: "رحلة" }]);
    expect(await h.as(guardian, async (q) => (await q(`select count(*)::int as n from notifications where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(1);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from notifications where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(0);
  });
  it("المخطط: مهمة اليوم تُجدول في وقت الإشعار مرة واحدة (dedupe)؛ وضع الاستراحة يوقفها", async () => {
    await h.as(n6, (q) => q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, suggested_for) values ($1,$2,1,2,'L1_hint', current_date)`, [n6Profile, TEMPLATE]));
    const prof = { id: n6Profile, user_id: n6.id, age_mode: "teen" as const, timezone: TZ, display_name: "نور", kind: "player" };
    const now = instantForLocal("2026-11-05", "10:00", TZ);
    expect(await planForProfile(svc, prof, now)).toBe(1);
    expect(await planForProfile(svc, prof, now)).toBe(0);
    const row = await h.service<{ scheduled_for: string; dedupe_key: string }>(`select scheduled_for, dedupe_key from notifications where profile_id = $1 and type = 'mission_today'`, [n6Profile]);
    expect(new Date(row.rows[0]!.scheduled_for).toISOString()).toBe(instantForLocal("2026-11-05", "17:00", TZ).toISOString());
    await h.as(n6, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'break_mode','true','player')`, [n6Profile]));
    await h.service(`delete from notifications where profile_id = $1`, [n6Profile]);
    expect(await planForProfile(svc, prof, now)).toBe(0);
    await h.service(`delete from settings where profile_id = $1 and key = 'break_mode'`, [n6Profile]);
  });
  it("التسليم: الحد اليومي (1) يؤجل الثاني إلى الغد؛ الدفع يصل لأجهزة المستلم؛ الاشتراك الميت يُحذف", async () => {
    const now = instantForLocal("2026-11-05", "17:05", TZ);
    // 0.4 و.4: الميزانية تتبع حالة التفاعل (steady = 2 للمراهق)؛ المستخدم يخفض ولا يرفع — هنا يضعها 1 كما كان في 0.3
    await h.as(n6, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'notification_max_per_day','1','player') on conflict (profile_id, key, set_by_role) do update set value = excluded.value`, [n6Profile]));
    await h.as(n6, (q) => q(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1,'https://push.example/n6-a','k','a'), ($1,'https://push.example/n6-dead','k','a')`, [n6.id]));
    await h.service(`insert into notifications (profile_id, type, scheduled_for, dedupe_key) values ($1,'mission_today',$2,'t1'), ($1,'comeback',$2,'t2')`, [n6Profile, new Date(now.getTime() - 60000).toISOString()]);
    const sender = fakeSender((sub) => (sub.endpoint.endsWith("dead") ? "gone" : "ok"));
    const r = await deliverDue(svc, sender, now);
    expect(r).toMatchObject({ sent: 1, deferred: 1, pushed: 1 });
    expect(sender.sent[0]!.payload.title.length).toBeGreaterThan(0);
    const deferred = await h.service<{ scheduled_for: string; deferred_count: number }>(`select scheduled_for, deferred_count from notifications where profile_id = $1 and sent_at is null`, [n6Profile]);
    expect(new Date(deferred.rows[0]!.scheduled_for).toISOString()).toBe(instantForLocal("2026-11-06", "17:00", TZ).toISOString());
    expect(deferred.rows[0]!.deferred_count).toBe(1);
    const subs = await h.service<{ n: number }>(`select count(*)::int as n from push_subscriptions where user_id = $1`, [n6.id]);
    expect(subs.rows[0]!.n).toBe(1);
  });
  it("ساعات الهدوء تؤجل الإشعار العادي؛ تنبيه الأمان للمربي يُرسل فورًا رغم الهدوء والحد (NOTIF-5)", async () => {
    const night = instantForLocal("2026-11-05", "23:30", TZ);
    await h.service(`delete from notifications where profile_id in ($1, $2)`, [n6Profile, teenProfile]);
    await h.service(`insert into notifications (profile_id, type, scheduled_for, dedupe_key) values ($1,'mission_today',$2,'t3')`, [n6Profile, night.toISOString()]);
    await h.as(guardian, (q) => q(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1,'https://push.example/guardian','k','a')`, [guardian.id]));
    await h.service(`insert into notifications (profile_id, type, scheduled_for, payload) values ($1,'safety_alert',$2,$3)`, [n6Profile, night.toISOString(), { guardian_id: guardian.id, flag_id: "x", bypass_limits: true }]);
    const sender = fakeSender();
    const r = await deliverDue(svc, sender, night);
    expect(r).toMatchObject({ sent: 1, deferred: 1, pushed: 1 });
    expect(sender.sent[0]!.sub.endpoint).toBe("https://push.example/guardian");
    expect(sender.sent[0]!.payload.url).toBe(`/guardian/${n6Profile}/chat`);
    const def = await h.service<{ scheduled_for: string }>(`select scheduled_for from notifications where profile_id = $1 and type = 'mission_today'`, [n6Profile]);
    expect(new Date(def.rows[0]!.scheduled_for).toISOString()).toBe(instantForLocal("2026-11-06", "07:00", TZ).toISOString());
  });
  it("الاحتفاظ (8.4): chat_auto_delete_days يحذف الرسائل الأقدم فقط", async () => {
    await h.as(n6, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'chat_auto_delete_days','30','player')`, [n6Profile]));
    const sid = (await h.service<{ id: string }>(`insert into companion_sessions (profile_id) values ($1) returning id`, [n6Profile])).rows[0]!.id;
    await h.service(`insert into companion_messages (session_id, role, content, created_at) values ($1,'player','قديمة', now() - interval '40 days'), ($1,'player','جديدة', now())`, [sid]);
    const r = await runRetention(svc, new Date());
    expect(r.messages).toBe(1);
    const left = await h.service<{ content: string }>(`select content from companion_messages where session_id = $1`, [sid]);
    expect(left.rows.map((x) => x.content)).toEqual(["جديدة"]);
  });
});
