/**
 * المرحلة 11 على قاعدة بيانات حقيقية (ب.15، ب.18-7، ح.9، ط.2/ط.6):
 * أدلة المخطط P1–P5 بحد 3 يوميًا لكل قدرة، المعاد جدولته تلقائيًا بلا أدلة، تحويل مهمة إلى تدريب وإنجازها يُنجز المهمة،
 * الوتيرة (لا خط أساس قبل 7 أيام؛ الطفل لا تُفعّل زيادته قبل موافقة المربي)، اقتراح أسبوع المرآة مرة واحدة ورفضه يمنع التكرار،
 * «تغيير واحد» ⇒ زيادة reallocate، وإعادة الحساب حتمية مع أدلة المخطط.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { createTask, completeTask, postponeTask, cancelTask, getTask } from "../../src/modules/planner/service";
import { afterTaskCompleted, afterTaskCancelled, afterDistraction, afterUserBreakdown, convertTaskToMission, autoRescheduleFor } from "../../src/modules/planner/bridge-service";
import { runWeeklyPace, capContext } from "../../src/modules/pace/service";
import { checkTarget } from "../../src/modules/pace/rules";
import { evaluateMirrorSuggestion } from "../../src/modules/mirror/suggest-service";
import { chooseChange, isMirrorWeek } from "../../src/modules/mirror/service";
import { recomputeSnapshots } from "../../src/modules/evidence/service";
import { instantForLocal } from "../../src/modules/notifications/plan";
import { addDays } from "../../src/modules/planner/recurrence";
import { planner } from "../../src/shared/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlannerTaskRow } from "../../src/modules/planner/types";

const h = new RlsHarness();
const TZ = "Asia/Amman";
const TODAY = "2026-11-07"; // سبت = بداية الأسبوع الافتراضية
const T = (d: string, t: string) => instantForLocal(d, t, TZ);
const NOW = T(TODAY, "12:00");
const base = { weekStart: "sat" as const, tz: TZ };
let teen: TestUser, adult: TestUser, creator: TestUser, childUser: TestUser;
let teenP: string, adultP: string, childP: string;
let svc: SupabaseClient, teenDb: SupabaseClient, adultDb: SupabaseClient;
const P = (id: string, age_mode: "child" | "teen" | "adult") => ({ id, age_mode, timezone: TZ });
const task = async (db: SupabaseClient, profileId: string, o: Record<string, unknown> = {}) => (await createTask(db, { ...base, profileId, title: "مهمة", due_date: TODAY, ...o }) as { ok: true; data: { id: string } }).data.id;
const rows = async (profile: string, rule: string) => (await h.service<{ rule_id: string; value: string; source: string; capability_id: string; context_tag: string }>(`select rule_id, value, source, capability_id, context_tag from evidence_events where profile_id = $1 and rule_id like $2`, [profile, `${rule}%`])).rows;

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  teen = await h.createUser("t11@test.local"); adult = await h.createUser("a11@test.local"); creator = await h.createUser("c11@test.local"); childUser = await h.createUser("child11@child.local");
  teenP = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','مراهق','teen',$2) returning id`, [teen.id, TZ])).rows[0].id);
  adultP = await h.as(adult, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','بالغ','adult',$2) returning id`, [adult.id, TZ])).rows[0].id);
  await h.as(creator, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','مربي')`, [creator.id]));
  childP = (await h.service<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','k11','mother','2026-11-05.1') as id`, [childUser.id, creator.id])).rows[0]!.id;
  await h.service(`update profiles set timezone = $2 where id = $1`, [childP, TZ]);
  teenDb = pgSupabaseShim(h.pool, teen); adultDb = pgSupabaseShim(h.pool, adult);
});
afterAll(() => h.teardown());

describe("أدلة المخطط P1–P5 (ب.11، ب.15)", () => {
  it("P1 من التقدير والفعلي، وحد 3 أدلة يوميًا لكل قدرة من المخطط", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await task(teenDb, teenP, { estimate_min: 30 });
      const r = await completeTask(teenDb, { taskId: id, actualMin: 30, ...base, now: T(TODAY, "09:00") });
      await afterTaskCompleted(svc, P(teenP, "teen"), (r as { ok: true; data: { task: PlannerTaskRow } }).data.task, T(TODAY, "09:00"));
    }
    const p1 = await rows(teenP, "P1");
    expect(p1).toHaveLength(planner.evidence_bridge.daily_cap_per_capability as number);
    expect(p1.every((r) => r.capability_id === "self_awareness" && Number(r.value) === 1)).toBe(true);
    const day = await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where profile_id = $1 and capability_id = 'self_awareness' and mission_id is null and created_at >= $2`, [teenP, T(TODAY, "00:00").toISOString()]);
    expect(day.rows[0]!.n).toBeLessThanOrEqual(3);
  });
  it("P3 بعد تأجيلين ثم إنجاز (+0.6)، P5 إلغاء واعٍ بسبب مكتوب (+0.5، self)، بلا سبب لا دليل، والسياق من المشروع", async () => {
    await h.service(`insert into planner_projects (profile_id, name, context_tag) values ($1, 'الجامعة', 'study')`, [adultP]);
    const proj = (await h.service<{ id: string }>(`select id from planner_projects where profile_id = $1`, [adultP])).rows[0]!.id;
    const id = await task(adultDb, adultP, { project_id: proj });
    await postponeTask(adultDb, { taskId: id, newDate: addDays(TODAY, 1) });
    await postponeTask(adultDb, { taskId: id, newDate: addDays(TODAY, 2) });
    const r = await completeTask(adultDb, { taskId: id, ...base, now: T(TODAY, "10:00") });
    await afterTaskCompleted(svc, P(adultP, "adult"), (r as { ok: true; data: { task: PlannerTaskRow } }).data.task, T(TODAY, "10:00"));
    const p3 = await rows(adultP, "P3");
    expect(p3).toHaveLength(1); expect(Number(p3[0]!.value)).toBeCloseTo(0.6); expect(p3[0]!.capability_id).toBe("perseverance"); expect(p3[0]!.context_tag).toBe("study");
    const c1 = await task(adultDb, adultP); await cancelTask(adultDb, { taskId: c1, reason: "مش مهمة فعلًا بعد ما فكرت" });
    expect(await afterTaskCancelled(svc, P(adultP, "adult"), (await getTask(adultDb, c1))!, T(TODAY, "10:05"))).toBe(true);
    const c2 = await task(adultDb, adultP); await cancelTask(adultDb, { taskId: c2, reason: null });
    expect(await afterTaskCancelled(svc, P(adultP, "adult"), (await getTask(adultDb, c2))!, T(TODAY, "10:06"))).toBe(false);
    const p5 = await rows(adultP, "P5");
    expect(p5).toHaveLength(1); expect(p5[0]!.source).toBe("self"); expect(Number(p5[0]!.value)).toBeCloseTo(0.5);
  });
  it("P2: رجع بعد التشتت +0.6، أنهى الجلسة −0.2 (attention، self)", async () => {
    expect(await afterDistraction(svc, P(adultP, "adult"), { sessionId: "00000000-0000-4000-8000-0000000000a1", taskId: null, returned: true, distractionNo: 1 }, T(TODAY, "11:00"))).toBe(true);
    expect(await afterDistraction(svc, P(adultP, "adult"), { sessionId: "00000000-0000-4000-8000-0000000000a1", taskId: null, returned: false, distractionNo: 2 }, T(TODAY, "11:10"))).toBe(true);
    const v = (await rows(adultP, "P2")).map((r) => Number(r.value)).sort();
    expect(v).toEqual([-0.2, 0.6]);
  });
  it("P4: عند L2+ تقسيم كتبه المستخدم +0.5؛ باستخدام task_breakdown أو عند L1 لا شيء (ولا سالب)", async () => {
    const id = await task(adultDb, adultP);
    const t = (await getTask(adultDb, id))!;
    await h.service(`insert into capability_states (profile_id, capability_id, support_level, training_level) values ($1,'planning','L1_hint','simulated') on conflict (profile_id, capability_id) do update set support_level = 'L1_hint'`, [adultP]);
    expect(await afterUserBreakdown(svc, P(adultP, "adult"), t, { userSteps: 3, usedAi: false }, T(TODAY, "12:00"))).toBe(false);
    await h.service(`update capability_states set support_level = 'L2_ask' where profile_id = $1 and capability_id = 'planning'`, [adultP]);
    expect(await afterUserBreakdown(svc, P(adultP, "adult"), t, { userSteps: 2, usedAi: true }, T(TODAY, "12:00"))).toBe(false);
    expect(await afterUserBreakdown(svc, P(adultP, "adult"), t, { userSteps: 2, usedAi: false }, T(TODAY, "12:00"))).toBe(true);
    const p4 = await rows(adultP, "P4"); expect(p4).toHaveLength(1); expect(Number(p4[0]!.value)).toBeCloseTo(0.5);
  });
});

describe("المعاد جدولته تلقائيًا (ب.10)", () => {
  it("للبالغ مع الإعداد فقط: يُنقل المتأخر لليوم ويُعلَّم، ولا يولّد أدلة حتى بعد إنجازه أو تأجيله يدويًا", async () => {
    const teenOver = await task(teenDb, teenP, { due_date: addDays(TODAY, -2) });
    await h.service(`insert into settings (profile_id, key, value, set_by_role) values ($1, 'overdue_auto_reschedule', 'true'::jsonb, 'player')`, [adultP]);
    const id = await task(adultDb, adultP, { due_date: addDays(TODAY, -2), estimate_min: 20 });
    expect(await autoRescheduleFor(svc, P(teenP, "teen"), NOW)).toBe(0);
    expect((await getTask(teenDb, teenOver))!.due_date).toBe(addDays(TODAY, -2));
    expect(await autoRescheduleFor(svc, P(adultP, "adult"), NOW)).toBeGreaterThanOrEqual(1);
    const moved = (await getTask(adultDb, id))!;
    expect(moved.due_date).toBe(TODAY); expect(moved.auto_rescheduled).toBe(true);
    await postponeTask(adultDb, { taskId: id, newDate: TODAY });
    await postponeTask(adultDb, { taskId: id, newDate: TODAY });
    expect((await getTask(adultDb, id))!.auto_rescheduled).toBe(true);
    const before = (await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where planner_task_id = $1`, [id])).rows[0]!.n;
    const r = await completeTask(adultDb, { taskId: id, actualMin: 20, ...base, now: addDays(TODAY, 1) === TODAY ? NOW : T(addDays(TODAY, 1), "09:00") });
    const out = await afterTaskCompleted(svc, P(adultP, "adult"), (r as { ok: true; data: { task: PlannerTaskRow } }).data.task, T(addDays(TODAY, 1), "09:00"));
    expect(out.evidence).toEqual([]);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where planner_task_id = $1`, [id])).rows[0]!.n).toBe(before);
  });
});

describe("تحويل مهمة إلى تدريب (ب.11)", () => {
  it("مهمة source=planner بمستوى حسب تدريب القدرة، مربوطة؛ إنجاز مهمة التدريب يُنجز المهمة الحقيقية", async () => {
    const id = await task(teenDb, teenP, { title: "تحضير عرض", estimate_min: 25 });
    const r = await convertTaskToMission(svc, P(teenP, "teen"), (await getTask(teenDb, id))!, { createdBy: teen.id, now: NOW });
    expect(r.ok).toBe(true);
    const mid = (r as { ok: true; missionId: string }).missionId;
    const again = await convertTaskToMission(svc, P(teenP, "teen"), (await getTask(teenDb, id))!, { createdBy: teen.id, now: NOW });
    expect((again as { ok: true; missionId: string }).missionId).toBe(mid);
    const m = (await h.service<{ source: string; planner_task_id: string; training_level: string }>(`select m.source, m.planner_task_id, t.training_level from missions m join mission_templates t on t.id = m.template_id and t.version = m.template_version where m.id = $1`, [mid])).rows[0]!;
    expect(m.source).toBe("planner"); expect(m.planner_task_id).toBe(id); expect(m.training_level).toBe("guided_real");
    for (const s of ["chosen", "planned", "in_progress", "completed"]) await h.service(`update missions set status = $2 where id = $1`, [mid, s]);
    expect((await getTask(teenDb, id))!.status).toBe("done");
  });
});

describe("الوتيرة الشخصية (ح.9)", () => {
  it("أقل من 7 أيام نشطة ⇒ لا خط أساس ولا اقتراح", async () => {
    for (let d = 1; d <= 3; d++) await h.service(`insert into app_opens (profile_id, local_date) values ($1, $2) on conflict do nothing`, [teenP, addDays(TODAY, -d)]);
    const r = await runWeeklyPace(svc, P(teenP, "teen"), NOW);
    expect(r.baseline).toBeNull(); expect(r.proposed).toBeNull();
  });
  it("child: اقتراح ≈ +10% بحد أدنى وحدة بموافقة المربي؛ الطفل لا يستطيع تفعيلها؛ المربي (manage_settings) يوافق", async () => {
    for (let d = 1; d <= 10; d++) {
      await h.service(`insert into app_opens (profile_id, local_date) values ($1, $2) on conflict do nothing`, [childP, addDays(TODAY, -d)]);
      await h.service(`insert into planner_focus_sessions (profile_id, started_at, ended_at, minutes, completed) values ($1, $2, $2, 20, true)`, [childP, T(addDays(TODAY, -d), "10:00").toISOString()]);
    }
    const r = await runWeeklyPace(svc, P(childP, "child"), NOW);
    expect(r.baseline?.focus_minutes_per_day).toBe(20);
    expect(r.proposed?.kind).toBe("longer"); expect(Number(r.proposed?.target_value)).toBe(22); expect(r.proposed?.requires_guardian).toBe(true);
    expect(Number(r.proposed?.target_value)).toBeLessThanOrEqual(20 * 1.25);
    // idempotent: لا اقتراح ثانٍ في الأسبوع نفسه
    const again = await runWeeklyPace(svc, P(childP, "child"), NOW);
    expect(again.proposed?.id).toBe(r.proposed?.id);
    // المتصفح لا يستدعي الدالة إطلاقًا (0017)؛ وعبر فعل الخادم بهوية الطفل تُرفض لأنها تحتاج المربي
    await expect(h.as(childUser, (q) => q(`select public.decide_increment($1, $2, 'accepted', null)`, [childUser.id, r.proposed!.id]))).rejects.toThrow(/permission denied/);
    await expect(h.service(`select public.decide_increment($1, $2, 'accepted', null)`, [childUser.id, r.proposed!.id])).rejects.toThrow(/not allowed/);
    expect((await h.service<{ status: string }>(`select status from growth_increments where id = $1`, [r.proposed!.id])).rows[0]!.status).toBe("proposed");
    await h.service(`select public.decide_increment($1, $2, 'accepted', null)`, [creator.id, r.proposed!.id]);
    expect((await h.service<{ status: string }>(`select status from growth_increments where id = $1`, [r.proposed!.id])).rows[0]!.status).toBe("accepted");
  });
  it("الأسبوع التالي: تحقيق 6 من 7 ⇒ achieved + XP increment_achieved (و3 من 7 ⇒ رجوع: rules.test)", async () => {
    const next = addDays(TODAY, 7);
    for (let d = 0; d < 7; d++) await h.service(`insert into planner_focus_sessions (profile_id, started_at, ended_at, minutes, completed) values ($1, $2, $2, $3, true)`, [childP, T(addDays(TODAY, d), "16:00").toISOString(), d < 6 ? 25 : 0]);
    for (let d = 0; d < 7; d++) await h.service(`insert into app_opens (profile_id, local_date) values ($1, $2) on conflict do nothing`, [childP, addDays(TODAY, d)]);
    const r = await runWeeklyPace(svc, P(childP, "child"), T(next, "12:00"));
    expect(r.evaluated[0]?.outcome).toBe("achieved"); expect(r.evaluated[0]?.achievedDays).toBe(6);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from xp_events where profile_id = $1 and reason = 'increment_achieved'`, [childP])).rows[0]!.n).toBe(1);
  });
  it("teen: لا يحتاج موافقة؛ المالك يقرر ويعدّل الهدف", async () => {
    for (let d = 4; d <= 10; d++) await h.service(`insert into app_opens (profile_id, local_date) values ($1, $2) on conflict do nothing`, [teenP, addDays(TODAY, -d)]);
    for (let d = 1; d <= 10; d++) await h.service(`insert into planner_focus_sessions (profile_id, started_at, ended_at, minutes, completed) values ($1, $2, $2, 40, true)`, [teenP, T(addDays(TODAY, -d), "10:00").toISOString()]);
    const r = await runWeeklyPace(svc, P(teenP, "teen"), T(addDays(TODAY, 1), "12:00"));
    expect(r.proposed?.requires_guardian).toBe(false);
    await h.service(`select public.decide_increment($1, $2, 'edited', 42)`, [teen.id, r.proposed!.id]);
    const row = (await h.service<{ status: string; target_value: string }>(`select status, target_value from growth_increments where id = $1`, [r.proposed!.id])).rows[0]!;
    expect(row.status).toBe("edited"); expect(Number(row.target_value)).toBe(42);
  });
});

describe("المرآة الذكية (ط.2، ط.6)", () => {
  it("التزام < 0.4 أسبوعين ⇒ اقتراح أسبوع مرآة مرة واحدة؛ رفضه يمنع تكراره 30 يومًا", async () => {
    for (let d = 1; d <= 14; d++) await h.service(`insert into engagement_states (profile_id, date, state, follow_through) values ($1, $2, 'low', 0.2) on conflict (profile_id, date) do update set follow_through = 0.2`, [adultP, addDays(TODAY, -d)]);
    expect(await evaluateMirrorSuggestion(svc, P(adultP, "adult"), NOW)).toBe("low_follow_through");
    expect(await evaluateMirrorSuggestion(svc, P(adultP, "adult"), NOW)).toBeNull();
    const sid = (await h.service<{ id: string }>(`select id from mirror_suggestions where profile_id = $1`, [adultP])).rows[0]!.id;
    await h.as(adult, (q) => q(`select public.decide_mirror_suggestion($1, false)`, [sid]));
    for (let d = 0; d <= 10; d++) await h.service(`insert into engagement_states (profile_id, date, state, follow_through) values ($1, $2, 'low', 0.2) on conflict (profile_id, date) do nothing`, [adultP, addDays(TODAY, d)]);
    expect(await evaluateMirrorSuggestion(svc, P(adultP, "adult"), T(addDays(TODAY, 10), "12:00"))).toBeNull();
    expect((await h.service<{ n: number }>(`select count(*)::int as n from notifications where profile_id = $1 and type = 'mirror_suggestion'`, [adultP])).rows[0]!.n).toBe(1);
  });
  it("ط.12-10: قبول الاقتراح يبدأ أسبوع المرآة حتى تكتمل الأيام المطلوبة", async () => {
    const id = (await h.service<{ id: string }>(`insert into mirror_suggestions (profile_id, reason) values ($1, 'monthly') returning id`, [teenP])).rows[0]!.id;
    expect(await isMirrorWeek(teenDb, teenP, TODAY)).toBe(false);
    await h.as(teen, (q) => q(`select public.decide_mirror_suggestion($1, true)`, [id]));
    expect(await isMirrorWeek(teenDb, teenP, TODAY)).toBe(true);
    const need = (await h.service<{ v: number }>(`select coalesce((select (value)::int from settings where profile_id = $1 and key = 'mirror_days_required' limit 1), 3) as v`, [teenP])).rows[0]!.v;
    for (let d = 0; d < need; d++) await h.service(`insert into day_reconstructions (profile_id, local_date, source, completed) values ($1, $2, 'manual', true) on conflict (profile_id, local_date) do update set completed = true`, [teenP, addDays(TODAY, -d)]);
    expect(await isMirrorWeek(teenDb, teenP, TODAY)).toBe(false);
  });
  it("«تغيير واحد بوعي» ⇒ زيادة reallocate مربوطة بالمرآة (بلا موافقة لغير الطفل)", async () => {
    await h.service(`insert into mirror_reports (profile_id, period_start, period_end, days_count, distribution, predictions, goal_alignment, patterns) values ($1, $2, $2, 1, '{"phone_screens": 120}', '[]', '[]', '[]')`, [adultP, TODAY]);
    const rid = (await h.service<{ id: string }>(`select id from mirror_reports where profile_id = $1`, [adultP])).rows[0]!.id;
    const r = await chooseChange(adultDb, svc, P(adultP, "adult"), { reportId: rid, text: "30 دقيقة من الجوال بعد العشا تروح للقراءة", now: NOW });
    expect(r.ok).toBe(true); expect(r.incrementId).not.toBeNull();
    const inc = (await h.service<{ kind: string; requires_guardian: boolean; status: string }>(`select kind, requires_guardian, status from growth_increments where id = $1`, [r.incrementId])).rows[0]!;
    expect(inc).toEqual({ kind: "reallocate", requires_guardian: false, status: "proposed" });
    expect((await h.service<{ chosen_change_increment_id: string }>(`select chosen_change_increment_id from mirror_reports where id = $1`, [rid])).rows[0]!.chosen_change_increment_id).toBe(r.incrementId);
  });
});

describe("ب.18-7 إعادة الحساب حتمية مع أدلة المخطط", () => {
  it("إعادة الحساب مرتين تعطي النتيجة نفسها، وتشمل أدلة P", async () => {
    const n = (await h.service<{ n: number }>(`select count(*)::int as n from evidence_events where profile_id = $1 and rule_id ~ '^P[0-9]'`, [adultP])).rows[0]!.n;
    expect(n).toBeGreaterThan(0);
    const a = await recomputeSnapshots(svc, adultP, NOW), b = await recomputeSnapshots(svc, adultP, NOW);
    expect(a).toEqual(b);
    expect(Number(a.find((s) => s.capability_id === "perseverance")!.score)).toBeGreaterThan(0);
  });
});

describe("سقف الزيادة على مرحلتين (pace.cap)", () => {
  it("ملف جديد في فترة الاكتشاف: لا سقف؛ بعد 28 يومًا و14 يوم نشاط: سقف ناعم يحتاج تأكيدًا", async () => {
    const fresh = await capContext(svc, P(teenP, "teen"), TODAY);
    expect(fresh.discovery).toBe(true);
    expect(checkTarget({ baseline: 40, target: 100, discovery: fresh.discovery, mode: fresh.mode, confirmed: false }).allowed).toBe(true);
    await h.service(`update profiles set created_at = $2 where id = $1`, [adultP, T(addDays(TODAY, -40), "09:00").toISOString()]);
    for (let d = 1; d <= 14; d++) await h.service(`insert into app_opens (profile_id, local_date) values ($1, $2) on conflict do nothing`, [adultP, addDays(TODAY, -d)]);
    const after = await capContext(svc, P(adultP, "adult"), TODAY);
    expect(after.discovery).toBe(false); expect(after.mode).toBe("soft");
    expect(checkTarget({ baseline: 30, target: 60, discovery: false, mode: after.mode, confirmed: false })).toEqual({ allowed: false, reason: "needs_confirm", cap: 45 });
  });
  it("child: السقف ثابت افتراضيًا، والمربي يحوّله ناعمًا", async () => {
    expect((await capContext(svc, P(childP, "child"), TODAY)).mode).toBe("hard");
    await h.service(`insert into settings (profile_id, key, value, set_by_role) values ($1, 'pace_cap_mode', '"soft"'::jsonb, 'guardian')`, [childP]);
    expect((await capContext(svc, P(childP, "child"), TODAY)).mode).toBe("soft");
  });
  it("هدف مؤكَّد فوق السقف وغير محقق ⇒ noted مع الفرق، بلا رجوع لخط الأساس، والاقتراح التالي +10% عادي", async () => {
    for (let d = 1; d <= 10; d++) await h.service(`insert into planner_focus_sessions (profile_id, started_at, ended_at, minutes, completed) values ($1, $2, $2, 30, true)`, [adultP, T(addDays(TODAY, -d), "18:00").toISOString()]);
    const id = (await h.service<{ id: string }>(`insert into growth_increments (profile_id, week_start, kind, metric, from_value, target_value) values ($1, $2, 'longer', 'focus_minutes_per_day', 30, 60) returning id`, [adultP, addDays(TODAY, -7)])).rows[0]!.id;
    await h.service(`select public.decide_increment($1, $2, 'accepted', null, true, false)`, [adult.id, id]);
    await h.service(`delete from engagement_states where profile_id = $1`, [adultP]); // أسبوع «low» من اختبار المرآة يفرض hold
    const r = await runWeeklyPace(svc, P(adultP, "adult"), NOW);
    const row = (await h.service<{ status: string; over_cap: boolean; gap: string; achieved_ratio: string }>(`select status, over_cap, gap, achieved_ratio from growth_increments where id = $1`, [id])).rows[0]!;
    expect(row.status).toBe("noted"); expect(row.over_cap).toBe(true);
    expect(Number(row.gap)).toBe(30); expect(Number(row.achieved_ratio)).toBe(0);
    expect(r.evaluated.find((e) => e.id === id)?.outcome).toBe("noted");
    expect(r.proposed?.kind).toBe("longer"); expect(Number(r.proposed?.target_value)).toBe(33);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from growth_increments where profile_id = $1 and status = 'stepped_back'`, [adultP])).rows[0]!.n).toBe(0);
  });
});
