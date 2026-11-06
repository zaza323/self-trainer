/**
 * المرحلة 9 (0.4 ب) على قاعدة بيانات حقيقية: RLS (ب.18-6)، عمق الفرعية، التكرار من الإنجاز (ب.18-2)،
 * التذكير خارج الحد اليومي ويحترم الهدوء إلا «مهم» (ب.18-3)، التأجيل 3 مرات ⇒ سؤال واحد بلا خصم (ب.18-4)،
 * view_planner للمنشئ في child وتعود معطلة عند teen→adult (ب.12)، وتثبيت مستوى الأدوات.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { createTask, completeTask, postponeTask, markPostponePrompted, addReminder, snoozeReminder, firePlannerReminders, moveOverdueToToday, getTask } from "../../src/modules/planner/service";
import { deliverDue } from "../../src/modules/notifications/service";
import { fakeSender } from "../../src/modules/notifications/sender";
import { instantForLocal } from "../../src/modules/notifications/plan";
import { limits, planner } from "../../src/shared/config";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = new RlsHarness();
const TZ = "Asia/Amman";
let teen: TestUser, guardianNo: TestUser, guardianYes: TestUser, stranger: TestUser, creator: TestUser, childUser: TestUser;
let teenProfile: string, childProfile: string;
let svc: SupabaseClient, teenDb: SupabaseClient;

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  teen = await h.createUser("t9@test.local");
  guardianNo = await h.createUser("gno9@test.local");
  guardianYes = await h.createUser("gyes9@test.local");
  stranger = await h.createUser("s9@test.local");
  creator = await h.createUser("c9@test.local");
  childUser = await h.createUser("child9@child.local");
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','مراهق','teen',$2) returning id`, [teen.id, TZ])).rows[0].id);
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));
  for (const g of [guardianNo, guardianYes, creator]) await h.as(g, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','مربي')`, [g.id]));
  for (const [g, perms] of [[guardianNo, { view_progress: true, add_missions: true }], [guardianYes, { view_progress: true, view_planner: true }]] as const) {
    const code = await h.as(teen, async (q) => (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'teacher',$3) returning code`, [teenProfile, teen.id, perms])).rows[0].code);
    await h.as(g, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
  }
  childProfile = (await h.service<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','k9','mother','2026-11-05.1') as id`, [childUser.id, creator.id])).rows[0]!.id;
  teenDb = pgSupabaseShim(h.pool, teen);
});
afterAll(() => h.teardown());

const base = { weekStart: "sat" as const, tz: TZ };

describe("RLS (ب.12، ب.18-6)", () => {
  let taskId: string;
  it("المالك ينشئ مهمة بوسوم وتذكير؛ مربٍ بلا view_planner لا يقرأ أي صف؛ مربٍ بها يقرأ؛ الغريب لا", async () => {
    const r = await createTask(teenDb, { ...base, profileId: teenProfile, title: "اجتماع", due_date: "2026-11-06", due_time: "17:00", tags: ["عمل"], reminders: [{ kind: "relative", offset_min: 60 }], created_via: "nlp" });
    expect(r.ok).toBe(true);
    taskId = (r as { ok: true; data: { id: string } }).data.id;
    for (const table of ["planner_tasks", "planner_tags", "planner_task_tags", "planner_reminders"]) {
      expect(await h.as(guardianNo, async (q) => (await q(`select count(*)::int as n from ${table}`)).rows[0].n), table).toBe(0);
      expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from ${table}`)).rows[0].n), table).toBe(0);
      expect(await h.as(guardianYes, async (q) => (await q(`select count(*)::int as n from ${table}`)).rows[0].n), table).toBe(1);
    }
    // المربي بـ view_planner يقرأ فقط ولا يكتب
    expect(await h.failsAs(guardianYes, `update planner_tasks set title = 'x' where id = $1 returning id`, [taskId])).toBeNull();
    expect((await h.service<{ title: string }>(`select title from planner_tasks where id = $1`, [taskId])).rows[0]!.title).toBe("اجتماع");
    expect(await h.failsAs(stranger, `insert into planner_tasks (profile_id, title) values ($1, 'x')`, [teenProfile])).toMatch(/row-level security/);
  });
  it("مربٍ بـ add_missions يضيف مهمة في مخطط المتدرب (created_via = guardian) ويعدّل ما أضافه فقط", async () => {
    expect(await h.failsAs(guardianNo, `insert into planner_tasks (profile_id, title, created_via, created_by) values ($1, 'من المربي', 'guardian', $2)`, [teenProfile, guardianNo.id])).toBeNull();
    expect(await h.failsAs(guardianNo, `insert into planner_tasks (profile_id, title, created_via, created_by) values ($1, 'x', 'manual', $2)`, [teenProfile, guardianNo.id])).toMatch(/row-level security/);
    expect(await h.failsAs(guardianYes, `insert into planner_tasks (profile_id, title, created_via, created_by) values ($1, 'x', 'guardian', $2)`, [teenProfile, guardianYes.id])).toMatch(/row-level security/);
    const n = await h.as(guardianNo, async (q) => (await q(`update planner_tasks set title = 'y' where id = $1`, [taskId])).rowCount);
    expect(n).toBe(0);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from planner_tasks where created_via = 'guardian'`)).rows[0].n)).toBe(1);
  });
  it("المهام الفرعية بعمق 1 فقط ومن الملف نفسه", async () => {
    const sub = await h.as(teen, async (q) => (await q(`insert into planner_tasks (profile_id, title, parent_task_id) values ($1,'فرعية',$2) returning id`, [teenProfile, taskId])).rows[0].id);
    expect(await h.failsAs(teen, `insert into planner_tasks (profile_id, title, parent_task_id) values ($1,'أعمق',$2)`, [teenProfile, sub])).toMatch(/depth 1/);
    const r = await createTask(teenDb, { ...base, profileId: teenProfile, title: "أعمق", parent_task_id: sub });
    expect(r).toEqual({ ok: false, error: "subtask_depth" });
  });
  it("view_planner: مفعّلة للمنشئ في child تلقائيًا؛ teen→adult تعيدها معطلة؛ الأماكن للمالك فقط", async () => {
    const link = await h.service<{ permissions: Record<string, boolean> }>(`select permissions from guardian_links where player_id = $1 and is_creator`, [childProfile]);
    expect(link.rows[0]!.permissions.view_planner).toBe(true);
    expect(await h.as(creator, async (q) => (await q(`select app.can_view_planner($1) as ok`, [childProfile])).rows[0].ok)).toBe(true);
    await h.as(teen, (q) => q(`select app.transition_age_mode($1,'adult')`, [teenProfile]));
    const after = await h.service<{ permissions: Record<string, boolean> }>(`select permissions from guardian_links where player_id = $1 and guardian_id = $2`, [teenProfile, guardianYes.id]);
    expect(after.rows[0]!.permissions.view_planner).toBe(false);
    expect(await h.as(guardianYes, async (q) => (await q(`select count(*)::int as n from planner_tasks`)).rows[0].n)).toBe(0);
    await h.service(`update guardian_links set permissions = permissions || '{"view_planner": true}' where player_id = $1 and guardian_id = $2`, [teenProfile, guardianYes.id]);
    await h.as(teen, (q) => q(`insert into planner_places (profile_id, label, lat, lng, radius_m) values ($1,'البيت',31.9,35.9,150)`, [teenProfile]));
    expect(await h.as(guardianYes, async (q) => (await q(`select count(*)::int as n from planner_places`)).rows[0].n)).toBe(0);
  });
});

describe("التكرار من الإنجاز (ب.18-2) والمهمة التالية", () => {
  it("«كل 3 أيام» من الإنجاز أُنجزت متأخرة يومين ⇒ التالية بعد 3 أيام من تاريخ الإنجاز، وتنسخ الوسوم والتذكير النسبي", async () => {
    const r = await createTask(teenDb, { ...base, profileId: teenProfile, title: "مراجعة الفصل", due_date: "2026-11-05", due_time: "18:00", priority: "high", recurrence: { kind: "every_n_days", n: 3 }, recur_from: "completion", tags: ["دراسة"], reminders: [{ kind: "relative", offset_min: 30 }] });
    const id = (r as { ok: true; data: { id: string } }).data.id;
    const done = await completeTask(teenDb, { taskId: id, actualMin: 40, ...base, now: instantForLocal("2026-11-07", "20:00", TZ) });
    expect(done.ok).toBe(true);
    const next = (done as { ok: true; data: { nextTaskId: string } }).data.nextTaskId;
    const row = await h.service<{ due_date: string; status: string; priority: string; recur_from: string }>(`select due_date::text, status, priority, recur_from from planner_tasks where id = $1`, [next]);
    expect(row.rows[0]).toMatchObject({ due_date: "2026-11-10", status: "open", priority: "high", recur_from: "completion" });
    expect((await h.service<{ n: number }>(`select count(*)::int as n from planner_task_tags where task_id = $1`, [next])).rows[0]!.n).toBe(1);
    const rem = await h.service<{ at: string; offset_min: number }>(`select at, offset_min from planner_reminders where task_id = $1`, [next]);
    expect(new Date(rem.rows[0]!.at).toISOString()).toBe(instantForLocal("2026-11-10", "17:30", TZ).toISOString());
    expect((await getTask(teenDb, id))!.actual_min).toBe(40);
  });
});

describe("التذكيرات (ب.5، ب.18-3)", () => {
  const svcSender = () => fakeSender(() => "ok");
  // تنظيف: تذكيرات الاختبارات السابقة لا تدخل في العدّ
  beforeAll(async () => { await h.service(`update planner_reminders set sent_at = now() where sent_at is null`); await h.service(`delete from notifications where profile_id = $1`, [teenProfile]); });
  it("تذكير المستخدم يُرسل رغم استنفاد الحد اليومي (خارج الحد)", async () => {
    const now = instantForLocal("2026-11-12", "17:05", TZ);
    const r = await createTask(teenDb, { ...base, profileId: teenProfile, title: "اتصل بالعميل", due_date: "2026-11-12", due_time: "17:00", reminders: [{ kind: "relative", offset_min: 0 }] });
    const id = (r as { ok: true; data: { id: string } }).data.id;
    // استنفاد الحد: إشعارات محسوبة أُرسلت اليوم بقدر الحد الصلب
    for (let i = 0; i < limits.notifications.hard_cap_per_day; i++) await h.service(`insert into notifications (profile_id, type, scheduled_for, sent_at, dedupe_key) values ($1,'mission_today',$2,$2,$3)`, [teenProfile, now.toISOString(), `cap-${i}`]);
    expect((await firePlannerReminders(svc, now)).fired).toBe(1);
    const d = await deliverDue(svc, svcSender(), now);
    expect(d.sent).toBe(1);
    const n = await h.service<{ type: string; sent_at: string | null; url: string }>(`select type, sent_at, url from notifications where profile_id = $1 and type = 'planner_reminder'`, [teenProfile]);
    expect(n.rows[0]!.sent_at).not.toBeNull();
    expect(n.rows[0]!.url).toBe(`/app/planner/${id}?reminder=${(await h.service<{ id: string }>(`select id from planner_reminders where task_id = $1`, [id])).rows[0]!.id}`);
    expect((await firePlannerReminders(svc, now)).fired).toBe(0); // لا تكرار
  });
  it("في ساعات الهدوء: بلا «مهم» يؤجَّل لنهايتها؛ بوسم «مهم» يُرسل فورًا", async () => {
    await h.as(teen, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'quiet_hours','["22:00","07:00"]','player') on conflict (profile_id, key, set_by_role) do update set value = excluded.value`, [teenProfile]));
    await h.service(`delete from notifications where profile_id = $1`, [teenProfile]);
    const night = instantForLocal("2026-11-13", "23:30", TZ);
    const a = await createTask(teenDb, { ...base, profileId: teenProfile, title: "عادي", due_date: "2026-11-13", due_time: "23:30", reminders: [{ kind: "relative", offset_min: 0 }] });
    const b = await createTask(teenDb, { ...base, profileId: teenProfile, title: "مهم", due_date: "2026-11-13", due_time: "23:30", reminders: [{ kind: "relative", offset_min: 0, important: true }] });
    expect(a.ok && b.ok).toBe(true);
    expect((await firePlannerReminders(svc, night)).fired).toBe(2);
    const d = await deliverDue(svc, svcSender(), night);
    expect(d).toMatchObject({ sent: 1, deferred: 1 });
    const rows = await h.service<{ payload: { title: string }; sent_at: string | null; scheduled_for: string }>(`select payload, sent_at, scheduled_for from notifications where profile_id = $1 and type = 'planner_reminder' and payload ->> 'title' in ('عادي','مهم')`, [teenProfile]);
    const normal = rows.rows.find((r) => r.payload.title === "عادي")!, important = rows.rows.find((r) => r.payload.title === "مهم")!;
    expect(important.sent_at).not.toBeNull();
    expect(normal.sent_at).toBeNull();
    expect(new Date(normal.scheduled_for).toISOString()).toBe(instantForLocal("2026-11-14", "07:00", TZ).toISOString());
  });
  it("Snooze: يعيد التذكير بعد المدة المختارة أو غدًا في الوقت المضبوط", async () => {
    const now = instantForLocal("2026-11-15", "10:00", TZ);
    const r = await createTask(teenDb, { ...base, profileId: teenProfile, title: "تأجيل", due_date: "2026-11-15", due_time: "09:00", reminders: [{ kind: "absolute", at: instantForLocal("2026-11-15", "09:00", TZ).toISOString() }] });
    const id = (r as { ok: true; data: { id: string } }).data.id;
    await firePlannerReminders(svc, now);
    const remId = (await h.service<{ id: string }>(`select id from planner_reminders where task_id = $1`, [id])).rows[0]!.id;
    const tomorrow = planner.reminders.snooze_options.find((o) => "tomorrow_at" in o)!;
    const s = await snoozeReminder(teenDb, { reminderId: remId, option: tomorrow, tz: TZ, now });
    expect(s.ok).toBe(true);
    expect((await firePlannerReminders(svc, now)).fired).toBe(0);
    const until = instantForLocal("2026-11-16", (tomorrow as { tomorrow_at: string }).tomorrow_at, TZ);
    expect((await firePlannerReminders(svc, until)).fired).toBe(1);
    expect(await addReminder(teenDb, { taskId: id, spec: { kind: "relative", offset_min: 10 }, tz: TZ })).toMatchObject({ ok: true });
  });
});

describe("التأجيل بلا عقوبة (ب.8، ب.18-4) والمتأخر", () => {
  it("3 تأجيلات ⇒ سؤال مرة واحدة؛ لا صف XP سالب؛ «انقل الكل لليوم»", async () => {
    const r = await createTask(teenDb, { ...base, profileId: teenProfile, title: "تقرير", due_date: "2026-11-01" });
    const id = (r as { ok: true; data: { id: string } }).data.id;
    const prompts: boolean[] = [];
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) {
      const p = await postponeTask(teenDb, { taskId: id, newDate: d });
      expect(p.ok).toBe(true);
      prompts.push((p as { ok: true; data: { prompt: boolean } }).data.prompt);
      if ((p as { ok: true; data: { prompt: boolean } }).data.prompt) await markPostponePrompted(teenDb, id);
    }
    expect(prompts).toEqual([false, false, true, false]);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from xp_events where profile_id = $1 and amount < 0`, [teenProfile])).rows[0]!.n).toBe(0);
    const moved = await moveOverdueToToday(teenDb, teenProfile, "2026-11-20");
    expect(moved.ok && moved.data.moved).toBeGreaterThanOrEqual(1);
    expect((await getTask(teenDb, id))!).toMatchObject({ due_date: "2026-11-20", postpone_count: 5, auto_rescheduled: false });
  });
  it("مستوى الأدوات يُثبَّت ولا ينخفض (never_lock_after_unlock)", async () => {
    await h.as(teen, (q) => q(`select app.planner_record_tier($1, 1)`, [teenProfile]));
    await h.as(teen, (q) => q(`select app.planner_record_tier($1, 0)`, [teenProfile]));
    expect((await h.service<{ t: number }>(`select planner_tier_max as t from profiles where id = $1`, [teenProfile])).rows[0]!.t).toBe(1);
    expect(await h.failsAs(stranger, `select app.planner_record_tier($1, 2)`, [teenProfile])).toMatch(/not allowed/);
  });
});
