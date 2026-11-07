/**
 * المرحلة 10 على قاعدة بيانات حقيقية: XP بشرط التقدير/الكتلة، «ما صارت» = XP التسجيل نفسه ولا دليل سلبي، العادات بأيام مرنة بلا إشعار،
 * الراحة بلا XP + إنجاز «راحة تجدّد»، المحاسبة (3 خطوات → أولويات الصباح تأكيدًا)، D1 بحد 3 يوميًا ولا سلبي، F1 عند L2 فقط،
 * الميزانية المتكيّفة (momentum/low/busy/away) مع تنبيه الأمان دائمًا، لغة low بلا أعداد، المرآة: RLS المجمّعة، R1، لا سلبي من الواقع.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { createTask, completeTask } from "../../src/modules/planner/service";
import { awardTaskCompletionXp } from "../../src/modules/planner/xp-service";
import { createHabit, checkinHabit, habitView } from "../../src/modules/planner/habits-service";
import { createBlock } from "../../src/modules/planner/blocks-service";
import { startFocus, endFocus } from "../../src/modules/planner/focus-service";
import { pendingFollowups, answerFollowup, startTransition } from "../../src/modules/followups/service";
import { startRest, endRest } from "../../src/modules/rest/service";
import { startMuhasaba, saveMuhasabaStep } from "../../src/modules/muhasaba/service";
import { loadStartScreen, answerMoment, evaluateDayPlanEvidence } from "../../src/modules/moments/service";
import { recordPlannerEvidence } from "../../src/modules/planner/evidence-service";
import { computeEngagement, busyNow, startDnd } from "../../src/modules/engagement/service";
import { getOrCreateReconstruction, completeReconstruction, saveMirror } from "../../src/modules/mirror/service";
import { deliverDue, buildMessage } from "../../src/modules/notifications/service";
import { fakeSender } from "../../src/modules/notifications/sender";
import { instantForLocal } from "../../src/modules/notifications/plan";
import { game, limits } from "../../src/shared/config";
import { engagementConfig } from "../../src/modules/engagement/state";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = new RlsHarness();
const TZ = "Asia/Amman";
let teen: TestUser, adult: TestUser, guardianYes: TestUser, guardianNo: TestUser;
let teenProfile: string, adultProfile: string;
let svc: SupabaseClient, teenDb: SupabaseClient, adultDb: SupabaseClient;
const T = (d: string, t: string) => instantForLocal(d, t, TZ);
const base = { weekStart: "sat" as const, tz: TZ };
const prof = (id: string, mode: "teen" | "adult", user: TestUser) => ({ id, user_id: user.id, age_mode: mode, timezone: TZ, display_name: "x" });
const xpSum = async (profile: string, reason?: string) => (await h.service<{ x: number }>(`select coalesce(sum(amount),0)::int as x from xp_events where profile_id = $1 ${reason ? "and reason = $2" : ""}`, reason ? [profile, reason] : [profile])).rows[0]!.x;

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  teen = await h.createUser("t10@test.local"); adult = await h.createUser("a10@test.local"); guardianYes = await h.createUser("gy10@test.local"); guardianNo = await h.createUser("gn10@test.local");
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','مراهق','teen',$2) returning id`, [teen.id, TZ])).rows[0].id);
  adultProfile = await h.as(adult, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','بالغ','adult',$2) returning id`, [adult.id, TZ])).rows[0].id);
  for (const g of [guardianYes, guardianNo]) await h.as(g, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','مربي')`, [g.id]));
  for (const [g, perms] of [[guardianYes, { view_progress: true, view_planner: true }], [guardianNo, { view_progress: true }]] as const) {
    const code = await h.as(teen, async (q) => (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'teacher',$3) returning code`, [teenProfile, teen.id, perms])).rows[0].code);
    await h.as(g, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
  }
  teenDb = pgSupabaseShim(h.pool, teen); adultDb = pgSupabaseShim(h.pool, adult);
});
afterAll(() => h.teardown());

describe("XP المخطط (معيار قبول المرحلة 10)", () => {
  it("إنجاز مهمة لا يعطي XP إلا بشرط التقدير (±20%) أو الكتلة الزمنية", async () => {
    const a = (await createTask(teenDb, { ...base, profileId: teenProfile, title: "بلا تقدير", due_date: "2026-11-07" }) as { ok: true; data: { id: string } }).data.id;
    const ra = await completeTask(teenDb, { taskId: a, actualMin: 20, ...base, now: T("2026-11-07", "10:00") });
    expect(await awardTaskCompletionXp(svc, (ra as { ok: true; data: { task: Parameters<typeof awardTaskCompletionXp>[1] } }).data.task, T("2026-11-07", "10:00"))).toBe(0);
    const b = (await createTask(teenDb, { ...base, profileId: teenProfile, title: "بتقدير", due_date: "2026-11-07", estimate_min: 30 }) as { ok: true; data: { id: string } }).data.id;
    const rb = await completeTask(teenDb, { taskId: b, actualMin: 35, ...base, now: T("2026-11-07", "10:10") });
    expect(await awardTaskCompletionXp(svc, (rb as { ok: true; data: { task: Parameters<typeof awardTaskCompletionXp>[1] } }).data.task, T("2026-11-07", "10:10"))).toBe(game.xp.rewards.planner_estimate_kept);
    const c = (await createTask(teenDb, { ...base, profileId: teenProfile, title: "بكتلة", due_date: "2026-11-07" }) as { ok: true; data: { id: string } }).data.id;
    await createBlock(teenDb, { profileId: teenProfile, taskId: c, startsAt: T("2026-11-07", "11:00").toISOString(), endsAt: T("2026-11-07", "12:00").toISOString() });
    const rc = await completeTask(teenDb, { taskId: c, ...base, now: T("2026-11-07", "11:30") });
    expect(await awardTaskCompletionXp(svc, (rc as { ok: true; data: { task: Parameters<typeof awardTaskCompletionXp>[1] } }).data.task, T("2026-11-07", "11:30"))).toBe(game.xp.rewards.planner_block_kept);
    expect((await h.service<{ kept: boolean }>(`select kept from planner_time_blocks where task_id = $1`, [c])).rows[0]!.kept).toBe(true);
  });
  it("جلسة تركيز مكتملة ⇒ 2 XP بحد 4 يوميًا، والدقائق تُضاف للمدة الفعلية", async () => {
    const t = (await createTask(teenDb, { ...base, profileId: teenProfile, title: "مذاكرة", due_date: "2026-11-08" }) as { ok: true; data: { id: string } }).data.id;
    let total = 0;
    for (let i = 0; i < 5; i++) {
      const s = await startFocus(teenDb, { profileId: teenProfile, taskId: t, now: T("2026-11-08", `${String(9 + i).padStart(2, "0")}:00`) });
      const r = await endFocus(teenDb, svc, { sessionId: (s as { ok: true; id: string }).id, completed: true, sessionNumberToday: i + 1, shortBreakMin: 5, now: T("2026-11-08", `${String(9 + i).padStart(2, "0")}:25`) });
      total += r.xp;
      if (i === 3) expect(r.break.kind).toBe("long");
    }
    expect(total).toBe(game.xp.rewards.focus_session_done * game.xp.planner_rules.focus_sessions_max_per_day);
    expect((await h.service<{ actual_min: number }>(`select actual_min from planner_tasks where id = $1`, [t])).rows[0]!.actual_min).toBe(125);
  });
});

describe("العادات (ب.7) والمتابعة (د)", () => {
  it("انقطاع يوم في عادة لها يوم مرن لا يكسر السلسلة؛ لا إشعار عند الانقطاع؛ XP التسجيل بحد 3", async () => {
    await h.service(`update planner_habits set created_at = '2026-11-01' where profile_id = $1`, [teenProfile]);
    const hb = await createHabit(teenDb, { profileId: teenProfile, title: "رياضة", schedule: { kind: "daily", time_local: "07:00", duration_min: 60 }, flexDays: 1 });
    const id = (hb as { ok: true; id: string }).id;
    await h.service(`update planner_habits set created_at = '2026-11-01T00:00:00Z' where id = $1`, [id]);
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-04"]) await checkinHabit(teenDb, svc, { habitId: id, profileId: teenProfile, date: d, ...base, now: T(d, "08:00") });
    const v = await habitView(teenDb, id, "2026-11-04", "sat");
    expect(v!.current).toBe(3); expect(v!.best).toBe(3);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from notifications where profile_id = $1`, [teenProfile])).rows[0]!.n).toBe(0);
    expect(await xpSum(teenProfile, "habit_checkin")).toBe(3 * game.xp.rewards.habit_checkin);
    await h.service(`delete from planner_habits where id = $1`, [id]);
  });
  it("د.11-1/2/4: عادة 7:00 لمدة 60 وفتح 8:20 ⇒ «تمّت؟»؛ «تمّت» تسجّل العادة؛ «ما صارت» تأخذ XP التسجيل نفسه ولا دليل سلبي", async () => {
    const hb = await createHabit(adultDb, { profileId: adultProfile, title: "رياضة", schedule: { kind: "daily", time_local: "07:00", duration_min: 60 }, flexDays: 1 });
    const t = (await createTask(adultDb, { ...base, profileId: adultProfile, title: "اتصال", due_date: "2026-11-09", due_time: "10:00", estimate_min: 30 }) as { ok: true; data: { id: string } }).data.id;
    const p = { id: adultProfile, age_mode: "adult" as const, timezone: TZ };
    const at820 = T("2026-11-09", "08:20");
    const pend = await pendingFollowups(adultDb, p, at820, "sat");
    expect(pend.items.map((x) => x.item_kind)).toEqual(["habit"]); expect(pend.presentation).toBe("sheets");
    const r1 = await answerFollowup(adultDb, svc, p, { followupId: pend.items[0]!.id, reply: "done", weekStart: "sat", now: at820 });
    expect(r1.xp).toBe(game.xp.rewards.followup_checkin);
    expect((await h.service<{ done: boolean }>(`select done from planner_habit_checkins where habit_id = $1 and date = '2026-11-09'`, [(hb as { ok: true; id: string }).id])).rows[0]!.done).toBe(true);
    const pend2 = await pendingFollowups(adultDb, p, T("2026-11-09", "11:00"), "sat");
    expect(pend2.items.map((x) => x.item_id)).toEqual([t]);
    const r2 = await answerFollowup(adultDb, svc, p, { followupId: pend2.items[0]!.id, reply: "missed", postponeTo: "2026-11-10", weekStart: "sat", now: T("2026-11-09", "11:00") });
    expect(r2.xp).toBe(game.xp.rewards.followup_checkin);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where profile_id = $1 and value < 0`, [adultProfile])).rows[0]!.n).toBe(0);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from xp_events where profile_id = $1 and amount < 0`, [adultProfile])).rows[0]!.n).toBe(0);
    expect((await h.service<{ due_date: string }>(`select due_date::text from planner_tasks where id = $1`, [t])).rows[0]!.due_date).toBe("2026-11-10");
  });
  it("د.11-8: بدء التالي بعد 8 دقائق عند L2 ⇒ F1 (+0.5)؛ عند L0 ⇒ لا F1؛ «وقت راحة» لا دليل", async () => {
    const p = { id: adultProfile, age_mode: "adult" as const, timezone: TZ };
    await h.service(`insert into capability_states (profile_id, capability_id, support_level, training_level) values ($1,'self_control','L2_ask','simulated') on conflict (profile_id, capability_id) do update set support_level = 'L2_ask'`, [adultProfile]);
    await h.service(`update planner_followups set answered_at = $2 where profile_id = $1 and status = 'done'`, [adultProfile, T("2026-11-09", "12:00").toISOString()]);
    const r = await startTransition(adultDb, svc, p, { fromFollowupId: null, nextKind: "task", nextItemId: null, suggestedBy: "user", transitionMin: 10, now: T("2026-11-09", "12:08") });
    expect(r.f1).toBe(true); expect(r.xp).toBe(game.xp.rewards.transition_started);
    const ev = await h.service<{ value: number; rule_id: string }>(`select value, rule_id from evidence_events where profile_id = $1 and rule_id like 'F1%'`, [adultProfile]);
    expect(ev.rows[0]!.value).toBe(0.5);
    await h.service(`update capability_states set support_level = 'L0_instruct' where profile_id = $1 and capability_id = 'self_control'`, [adultProfile]);
    const r2 = await startTransition(adultDb, svc, p, { fromFollowupId: null, nextKind: "task", nextItemId: null, suggestedBy: "user", transitionMin: 10, now: T("2026-11-09", "12:09") });
    expect(r2.f1).toBe(false);
    const r3 = await startTransition(adultDb, svc, p, { fromFollowupId: null, nextKind: "rest", nextItemId: null, suggestedBy: "user", transitionMin: 10, now: T("2026-11-09", "12:09") });
    expect(r3.f1).toBe(false); expect(r3.xp).toBe(0);
  });
});

describe("الراحة (هـ)", () => {
  it("لا XP على الراحة؛ ذاكرة الراحة؛ إنجاز «راحة تجدّد» بعد 5 في أسبوع؛ لا بيانات نوم", async () => {
    const p = { id: teenProfile, age_mode: "teen" as const, timezone: TZ };
    const before = await xpSum(teenProfile);
    for (let i = 0; i < 5; i++) {
      const s = await startRest(teenDb, p, { activityKey: "breathing", plannedMin: 5, source: "next", now: T("2026-11-08", `${String(10 + i).padStart(2, "0")}:00`) });
      const r = await endRest(teenDb, svc, p, { sessionId: (s as { ok: true; id: string }).id, feel: "more", weekStart: "sat", now: T("2026-11-08", `${String(10 + i).padStart(2, "0")}:05`) });
      if (i === 4) expect(r.achievement).toBe(true);
    }
    expect(await xpSum(teenProfile)).toBe(before);
    const o = await h.service<{ uses: number; felt_more_count: number }>(`select uses, felt_more_count from rest_outcomes where profile_id = $1 and activity_key = 'breathing'`, [teenProfile]);
    expect(o.rows[0]).toEqual({ uses: 5, felt_more_count: 5 });
    const cols = await h.service<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'rest_sessions'`);
    expect(cols.rows.map((c) => c.column_name).join(",")).not.toMatch(/sleep|quality/);
  });
});

describe("لحظات اليوم (ج) ومحاسبة النفس (ز)", () => {
  it("ج.10-1/5/9: افتتاحية الصباح بأرقام من المخطط؛ المحاسبة تجعل الصباح تأكيدًا؛ D1 بلا سلبي وبحد 3 يوميًا", async () => {
    const p = prof(teenProfile, "teen", teen);
    const t1 = (await createTask(teenDb, { ...base, profileId: teenProfile, title: "واجب", due_date: "2026-11-10" }) as { ok: true; data: { id: string } }).data.id;
    const t2 = (await createTask(teenDb, { ...base, profileId: teenProfile, title: "قراءة", due_date: "2026-11-10" }) as { ok: true; data: { id: string } }).data.id;
    const morning = await loadStartScreen(teenDb, p, { now: T("2026-11-10", "08:00"), safetyPending: false, comeback: false, followupsPending: 0 });
    expect(morning.decision).toEqual({ kind: "moment", moment: "morning_plan", confirm: false });
    expect(morning.openerText.length).toBeGreaterThan(0); expect(morning.todayCount).toBeGreaterThanOrEqual(2);
    // المحاسبة ليلًا: ثلاث خطوات تنتهي بالخطوة القادمة ⇒ أولويات الغد
    const v = await startMuhasaba(teenDb, p, T("2026-11-10", "21:30"), "sat");
    expect(v.steps).toEqual(["achieved", "shortfall", "next"]);
    await saveMuhasabaStep(teenDb, svc, p, { entryId: v.entry.id, step: "achieved", achieved: [{ text: "واجب", source: "user" }] });
    const bad = await saveMuhasabaStep(teenDb, svc, p, { entryId: v.entry.id, step: "shortfall", shortfalls: [{ text: "أ", reason: "ر", task_id: null }, { text: "ب", reason: null, task_id: null }, { text: "ج", reason: null, task_id: null }, { text: "د", reason: null, task_id: null }] });
    expect(bad).toMatchObject({ ok: false, error: "too_many" });
    await saveMuhasabaStep(teenDb, svc, p, { entryId: v.entry.id, step: "shortfall", shortfalls: [{ text: "قراءة", reason: "ضاق الوقت", task_id: t2 }] });
    const fin = await saveMuhasabaStep(teenDb, svc, p, { entryId: v.entry.id, step: "next", nextSteps: [{ text: "قراءة", task_id: t2 }, { text: "واجب", task_id: t1 }], now: T("2026-11-10", "21:40") });
    expect(fin.completed).toBe(true); expect(fin.xp).toBe(game.xp.rewards.muhasaba_done + game.xp.rewards.daily_plan_set);
    const next = await loadStartScreen(teenDb, p, { now: T("2026-11-11", "08:00"), safetyPending: false, comeback: false, followupsPending: 0 });
    expect(next.decision).toEqual({ kind: "moment", moment: "morning_plan", confirm: true });
    expect(next.openerText).toContain("قراءة");
    // D1: أُنجزت واحدة من اثنتين ⇒ 0.4؛ لا سلبي
    await completeTask(teenDb, { taskId: t2, ...base, now: T("2026-11-11", "10:00") });
    await answerMoment(teenDb, svc, p, { date: "2026-11-11", moment: "morning_plan", priorities: [{ task_id: t2, text: "قراءة" }, { task_id: t1, text: "واجب" }], confirm: true, now: T("2026-11-11", "08:05") });
    const ev = await evaluateDayPlanEvidence(svc, p, "2026-11-11", T("2026-11-11", "22:00"));
    expect(ev.d1).toBe(true);
    const rows = await h.service<{ rule_id: string; value: number }>(`select rule_id, value from evidence_events where profile_id = $1 and rule_id like 'D%' order by created_at`, [teenProfile]);
    expect(rows.rows.find((r) => r.rule_id.startsWith("D1"))!.value).toBe(0.4);
    expect(rows.rows.every((r) => r.value >= 0)).toBe(true);
    // الحد 3 يوميًا لكل قدرة من المخطط
    let ok = 0;
    for (let i = 0; i < 5; i++) if (await recordPlannerEvidence(svc, { profileId: teenProfile, ageMode: "teen", ruleId: "D1", capability: "planning", type: "strategy_fit", source: "auto", value: 0.8, dedupeKey: `cap-${i}` }, T("2026-11-12", "10:00"))) ok++;
    expect(ok).toBe(3);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from ai_calls where profile_id = $1`, [teenProfile])).rows[0]!.n).toBe(0); // ج.10-10: لا ذكاء اصطناعي عند الفتح
  });
});

describe("التفاعل والإشعارات المتكيّفة (و.9)", () => {
  const sender = () => fakeSender(() => "ok");
  it("1/3/8: momentum adult ⇒ حتى 6 بتباعد 60؛ low ⇒ إشعار واحد بلا أعداد؛ child لا يتجاوز 3", async () => {
    const p = { id: adultProfile, age_mode: "adult" as const, timezone: TZ };
    await h.service(`delete from notifications where profile_id = $1`, [adultProfile]);
    await h.service(`insert into engagement_states (profile_id, date, state) values ($1,'2026-11-12','momentum')`, [adultProfile]);
    const t0 = T("2026-11-12", "10:00");
    for (let i = 0; i < 8; i++) await h.service(`insert into notifications (profile_id, type, scheduled_for, dedupe_key) values ($1,'mission_today',$2,$3)`, [adultProfile, t0.toISOString(), `m-${i}`]);
    let sent = 0;
    for (let k = 0; k < 8; k++) { const r = await deliverDue(svc, sender(), new Date(t0.getTime() + k * 60 * 60000)); sent += r.sent; }
    expect(sent).toBe(6);
    const times = (await h.service<{ sent_at: string }>(`select sent_at from notifications where profile_id = $1 and sent_at is not null and type = 'mission_today' order by sent_at`, [adultProfile])).rows.map((r) => new Date(r.sent_at).getTime());
    for (let i = 1; i < times.length; i++) expect((times[i]! - times[i - 1]!) / 60000).toBeGreaterThanOrEqual(60);
    const low = buildMessage({ id: "x", profile_id: adultProfile, type: "mission_today", scheduled_for: "", payload: {}, deferred_count: 0 }, { id: adultProfile, user_id: adult.id, age_mode: "adult", timezone: TZ, display_name: "x", kind: "player" }, "low", t0)!;
    expect(low.body + low.title).not.toMatch(/\d/);
    expect(engagementConfig.ceiling.child).toBe(3); expect(limits.notifications.hard_cap_per_day).toBeGreaterThanOrEqual(engagementConfig.ceiling.adult);
    void p;
  });
  it("4/9: «لا تزعجني» ⇒ مشغول: لا إشعار غير عاجل؛ تنبيه الأمان للمربي يُرسل؛ بعد الانتهاء إشعار واحد مجمّع", async () => {
    await h.service(`delete from notifications where profile_id = $1`, [adultProfile]);
    await h.service(`update engagement_states set state = 'steady' where profile_id = $1`, [adultProfile]);
    const p = { id: adultProfile, age_mode: "adult" as const, timezone: TZ };
    const t0 = T("2026-11-13", "10:00");
    await startDnd(adultDb, adultProfile, "1h", TZ, t0);
    expect(await busyNow(svc, p, t0)).toBe(true);
    await h.service(`insert into notifications (profile_id, type, scheduled_for, dedupe_key) values ($1,'mission_today',$2,'b1'), ($1,'comeback',$2,'b2')`, [adultProfile, t0.toISOString()]);
    await h.service(`insert into notifications (profile_id, type, scheduled_for, payload) values ($1,'safety_alert',$2,$3)`, [adultProfile, t0.toISOString(), { guardian_id: guardianYes.id, bypass_limits: true }]);
    const r = await deliverDue(svc, sender(), new Date(t0.getTime() + 60000));
    expect(r.sent).toBe(1); expect(r.deferred).toBe(2);
    expect((await h.service<{ type: string }>(`select type from notifications where profile_id = $1 and sent_at is not null`, [adultProfile])).rows.map((x) => x.type)).toEqual(["safety_alert"]);
    const r2 = await deliverDue(svc, sender(), new Date(t0.getTime() + 2 * 3600000));
    expect(r2.sent).toBe(1);
    const bundle = await h.service<{ type: string; bundled_ids: string[] }>(`select type, bundled_ids from notifications where profile_id = $1 and type = 'busy_bundle'`, [adultProfile]);
    expect(bundle.rows).toHaveLength(1); expect(bundle.rows[0]!.bundled_ids).toHaveLength(1);
  });
  it("5/7: الحالة تُحسب من البيانات؛ غياب 3 أيام ⇒ away وإشعار واحد فقط بإيقاع الغياب", async () => {
    const p = { id: teenProfile, age_mode: "teen" as const, timezone: TZ };
    await h.service(`delete from app_opens where profile_id = $1`, [teenProfile]);
    await h.service(`insert into app_opens (profile_id, local_date) values ($1,'2026-11-10')`, [teenProfile]);
    const s = await computeEngagement(svc, p, T("2026-11-14", "10:00"));
    expect(s.state).toBe("away");
    await h.service(`delete from notifications where profile_id = $1`, [teenProfile]);
    await h.service(`insert into notifications (profile_id, type, scheduled_for, dedupe_key) values ($1,'mission_today',$2,'aw1')`, [teenProfile, T("2026-11-14", "10:00").toISOString()]);
    const r = await deliverDue(svc, sender(), T("2026-11-14", "10:05"));
    expect(r.dropped).toBe(1); expect(r.sent).toBe(0);
  });
});

describe("مرآة الواقع (ط) — RLS وR1", () => {
  it("ط.12-2/7/8/9: الملء المسبق؛ R1 بالقيمة الصحيحة ولا دليل سلبي من الواقع؛ المربي يرى التوزيع فقط ولا يقرأ time_blocks_actual", async () => {
    const p = { id: teenProfile, age_mode: "teen" as const, timezone: TZ };
    const rec = await getOrCreateReconstruction(teenDb, p, { date: "2026-11-08", source: "manual", now: T("2026-11-09", "09:00") });
    expect(rec.blocks.some((b) => b.origin === "prefilled" && b.category === "restorative_rest")).toBe(true); // جلسات الراحة
    await h.service(`insert into time_blocks_actual (reconstruction_id, starts_at, ends_at, category, origin) values ($1,$2,$3,'phone_screens','manual')`, [rec.rec.id, T("2026-11-08", "20:00").toISOString(), T("2026-11-08", "23:42").toISOString()]);
    const done = await completeReconstruction(teenDb, svc, p, { reconstructionId: rec.rec.id, now: T("2026-11-09", "09:10") });
    expect(done.xp).toBe(game.xp.rewards.day_reconstructed);
    const before = (await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where profile_id = $1 and value < 0 and rule_id not like 'R1%'`, [teenProfile])).rows[0]!.n;
    const m = await saveMirror(teenDb, svc, p, { days: 1, predictions: [{ category: "phone_screens", predicted_hours: 1.5 }], now: T("2026-11-09", "09:20") });
    expect(m.ok && m.r1).toBe(true);
    const r1 = await h.service<{ value: number; source: string }>(`select value, source from evidence_events where profile_id = $1 and rule_id like 'R1%'`, [teenProfile]);
    expect(r1.rows[0]!.source).toBe("self"); expect(r1.rows[0]!.value).toBe(-1); // توقّع 1.5 والواقع 3.7 ⇒ دليل وعي بالتوقّع (المعادلة)، لا حكم على السلوك
    expect((await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where profile_id = $1 and value < 0 and rule_id not like 'R1%'`, [teenProfile])).rows[0]!.n).toBe(before);
    expect(await h.as(guardianYes, async (q) => (await q(`select count(*)::int as n from mirror_reports where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(1);
    expect(await h.as(guardianYes, async (q) => (await q(`select count(*)::int as n from time_blocks_actual`)).rows[0].n)).toBe(0);
    expect(await h.as(guardianYes, async (q) => (await q(`select count(*)::int as n from day_reconstructions`)).rows[0].n)).toBe(0);
    expect(await h.as(guardianNo, async (q) => (await q(`select count(*)::int as n from mirror_reports`)).rows[0].n)).toBe(0);
    expect(await h.as(guardianYes, async (q) => (await q(`select count(*)::int as n from muhasaba_entries where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(1);
    expect(await h.as(guardianNo, async (q) => (await q(`select count(*)::int as n from muhasaba_entries`)).rows[0].n)).toBe(0);
  });
});
