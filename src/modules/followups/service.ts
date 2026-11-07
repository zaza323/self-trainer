import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { localParts, instantForLocal } from "@/modules/notifications/plan";
import { addDays, type WeekStart } from "@/modules/planner/recurrence";
import { scheduledOn, type HabitSchedule } from "@/modules/planner/habits";
import { completeTask, postponeTask, cancelTask } from "@/modules/planner/service";
import { checkinHabit } from "@/modules/planner/habits-service";
import { awardPlannerXp } from "@/modules/planner/xp-service";
import { afterTaskCompleted } from "@/modules/planner/bridge-service";
import { recordPlannerEvidence, supportIndexFor } from "@/modules/planner/evidence-service";
import { f1Value } from "@/modules/planner/evidence-values";
import { buildScheduled, endedItems, presentation, snoozeAllowed, nextCard, transitionStarted, upcomingSoon, followupConfig, type ScheduledItem, type NextDecision } from "./compute";
import type { PlannerTaskRow } from "@/modules/planner/types";
import { SUPPORT_LEVELS } from "@/shared/config";

type Db = SupabaseClient;
export type FollowupRow = { id: string; profile_id: string; item_kind: "task" | "block" | "habit" | "mission"; item_id: string; occurrence_date: string; scheduled_end: string; status: "pending" | "done" | "partial" | "missed" | "postponed" | "snoozed"; snooze_count: number; duration_feel: string | null; answered_at: string | null };
export type FollowupView = FollowupRow & { title: string; startsAt: string; taskId: string | null; estimateMin: number | null };
export type FollowupSettings = { enabled: boolean; graceMin: number; lookbackHours: number; defaultDurationMin: number; freeGapMin: number; transitionMin: number; upcomingSoonMin: number };
export type Profile = { id: string; age_mode: AgeMode; timezone: string };

export async function followupSettings(db: Db, profileId: string): Promise<FollowupSettings> {
  const [en, grace, look, dur, gap, tr, soon] = await Promise.all([
    effective<boolean>(db, profileId, "followup_enabled"), effective<number>(db, profileId, "followup_grace_minutes"), effective<number>(db, profileId, "followup_lookback_hours"),
    effective<number>(db, profileId, "followup_default_duration_min"), effective<number>(db, profileId, "free_gap_minutes"), effective<number>(db, profileId, "transition_minutes"), effective<number>(db, profileId, "upcoming_soon_minutes"),
  ]);
  return { enabled: en.value, graceMin: grace.value, lookbackHours: look.value, defaultDurationMin: dur.value, freeGapMin: gap.value, transitionMin: tr.value, upcomingSoonMin: soon.value };
}

/** جدول يوم محلي من المهام بوقت والكتل والعادات بوقت (د.2). */
export async function scheduledFor(db: Db, p: Profile, date: string, s: FollowupSettings, weekStart: WeekStart): Promise<ScheduledItem[]> {
  const dayStart = instantForLocal(date, "00:00", p.timezone).toISOString(), dayEnd = instantForLocal(addDays(date, 1), "00:00", p.timezone).toISOString();
  const [{ data: tasks }, { data: blocks }, { data: habits }] = await Promise.all([
    db.from("planner_tasks").select("id, title, due_date, due_time, estimate_min, status").eq("profile_id", p.id).eq("due_date", date).is("parent_task_id", null),
    db.from("planner_time_blocks").select("id, task_id, starts_at, ends_at").eq("profile_id", p.id).gte("starts_at", dayStart).lt("starts_at", dayEnd),
    db.from("planner_habits").select("id, title, schedule").eq("profile_id", p.id).eq("archived", false),
  ]);
  const taskRows = (tasks ?? []) as Array<{ id: string; title: string; due_date: string | null; due_time: string | null; estimate_min: number | null; status: string }>;
  const blockRows = (blocks ?? []) as Array<{ id: string; task_id: string | null; starts_at: string; ends_at: string }>;
  const titles = new Map(taskRows.map((t) => [t.id, t.title]));
  const missing = blockRows.filter((b) => b.task_id && !titles.has(b.task_id)).map((b) => b.task_id!);
  if (missing.length) { const { data: more } = await db.from("planner_tasks").select("id, title").in("id", missing); for (const t of (more ?? []) as Array<{ id: string; title: string }>) titles.set(t.id, t.title); }
  return buildScheduled({
    date, tz: p.timezone, defaultDurationMin: s.defaultDurationMin, tasks: taskRows,
    blocks: blockRows.map((b) => ({ ...b, title: b.task_id ? titles.get(b.task_id) ?? "" : "" })),
    habits: ((habits ?? []) as Array<{ id: string; title: string; schedule: HabitSchedule }>).map((h) => ({ ...h, scheduledToday: scheduledOn(h.schedule, date, weekStart) })),
  });
}

/** يكتشف ما انتهى وقته (اليوم وأمس داخل نافذة النظر للخلف) ويضمن صفوف المتابعة المعلقة، ويعيد ما يُعرض الآن. */
export async function pendingFollowups(db: Db, p: Profile, now: Date, weekStart: WeekStart): Promise<{ items: FollowupView[]; presentation: "sheets" | "list" | "none"; settings: FollowupSettings }> {
  const s = await followupSettings(db, p.id);
  if (!s.enabled) return { items: [], presentation: "none", settings: s };
  const today = localParts(now, p.timezone).date;
  const sched = [...(await scheduledFor(db, p, addDays(today, -1), s, weekStart)), ...(await scheduledFor(db, p, today, s, weekStart))];
  const ended = endedItems(sched, now, { graceMin: s.graceMin, lookbackHours: s.lookbackHours });
  if (ended.length) {
    await db.from("planner_followups").upsert(ended.map((e) => ({ profile_id: p.id, item_kind: e.kind, item_id: e.id, occurrence_date: e.occurrenceDate, scheduled_end: e.endsAt.toISOString() })), { onConflict: "item_kind,item_id,occurrence_date", ignoreDuplicates: true });
  }
  const { data: rows } = await db.from("planner_followups").select("*").eq("profile_id", p.id).in("status", ["pending", "snoozed"]).gte("scheduled_end", new Date(now.getTime() - s.lookbackHours * 3600000).toISOString()).order("scheduled_end", { ascending: true });
  const views: FollowupView[] = [];
  for (const r of (rows ?? []) as FollowupRow[]) {
    if (r.status === "snoozed" && !snoozeAllowed(r.snooze_count - 1)) continue;       // «بعدين» مرتين ⇒ للمتأخر بهدوء
    if (r.status === "snoozed" && r.answered_at && now.getTime() - new Date(r.answered_at).getTime() < 60000) continue; // أُجّل للتو: حتى الفتح التالي
    const it = sched.find((x) => x.kind === r.item_kind && x.id === r.item_id && x.occurrenceDate === r.occurrence_date);
    if (!it) continue;
    const est = it.kind === "task" ? ((await db.from("planner_tasks").select("estimate_min").eq("id", it.id).maybeSingle()).data?.estimate_min as number | null) ?? null : null;
    views.push({ ...r, title: it.title, startsAt: it.startsAt.toISOString(), taskId: it.taskId ?? null, estimateMin: est });
  }
  return { items: views, presentation: presentation(views.length), settings: s };
}

export type FollowupReply = "done" | "partial" | "missed" | "postponed" | "snoozed";

/** د.3: الرد بلمسة. «تمّت» تُنجز المهمة/تُسجل العادة/تحفظ الكتلة؛ أي رد يأخذ XP التسجيل نفسه (مبدأ الصدق)؛ «بعدين» بلا XP. */
export async function answerFollowup(db: Db, admin: Db | null, p: Profile, i: { followupId: string; reply: FollowupReply; postponeTo?: string | null; durationFeel?: "less" | "about" | "more" | null; weekStart: WeekStart; now?: Date }): Promise<{ ok: boolean; xp: number; error?: string }> {
  const now = i.now ?? new Date();
  const { data: f } = await db.from("planner_followups").select("*").eq("id", i.followupId).maybeSingle();
  if (!f) return { ok: false, xp: 0, error: "not_found" };
  const row = f as FollowupRow;
  if (i.reply === "snoozed") {
    if (!snoozeAllowed(row.snooze_count)) { await db.from("planner_followups").update({ status: "missed", answered_at: now.toISOString() }).eq("id", row.id); return { ok: true, xp: 0 }; }
    await db.from("planner_followups").update({ status: "snoozed", snooze_count: row.snooze_count + 1, answered_at: now.toISOString() }).eq("id", row.id);
    return { ok: true, xp: 0 };
  }
  const today = localParts(now, p.timezone).date;
  if (i.reply === "done") {
    if (row.item_kind === "task") { const r = await completeTask(db, { taskId: row.item_id, tz: p.timezone, weekStart: i.weekStart, now }); if (r.ok && admin) await afterTaskCompleted(admin, p, r.data.task, now); }
    else if (row.item_kind === "habit") await checkinHabit(db, admin, { habitId: row.item_id, profileId: p.id, date: row.occurrence_date, weekStart: i.weekStart, now });
    else if (row.item_kind === "block") { await db.from("planner_time_blocks").update({ kept: true }).eq("id", row.item_id); const { data: b } = await db.from("planner_time_blocks").select("task_id").eq("id", row.item_id).maybeSingle(); if (b?.task_id) { const r = await completeTask(db, { taskId: b.task_id as string, tz: p.timezone, weekStart: i.weekStart, now }); if (r.ok && admin) await afterTaskCompleted(admin, p, r.data.task, now); } }
  } else if (i.reply === "missed") {
    if (row.item_kind === "block") await db.from("planner_time_blocks").update({ kept: false }).eq("id", row.item_id);
    if (row.item_kind === "habit") await checkinHabit(db, null, { habitId: row.item_id, profileId: p.id, date: row.occurrence_date, done: false, weekStart: i.weekStart, now });
    if (row.item_kind === "task" && i.postponeTo === "cancel") await cancelTask(db, { taskId: row.item_id, reason: null });
    else if (row.item_kind === "task" && i.postponeTo && i.postponeTo !== "cancel") await postponeTask(db, { taskId: row.item_id, newDate: i.postponeTo });
  } else if (i.reply === "postponed") {
    if (row.item_kind === "task") await postponeTask(db, { taskId: row.item_id, newDate: i.postponeTo ?? addDays(today, 1) });
  }
  await db.from("planner_followups").update({ status: i.reply, answered_at: now.toISOString(), duration_feel: i.durationFeel ?? null }).eq("id", row.id);
  const xp = admin ? await awardPlannerXp(admin, p.id, "followup_checkin", row.id, now) : 0;   // «ما صارت» نفس النقطة (د.7)
  return { ok: true, xp };
}

/** هل سُئل سؤال المدة اليوم؟ (مرة واحدة يوميًا كحد أقصى) */
export async function durationFeelAskedToday(db: Db, profileId: string, today: string): Promise<boolean> {
  const { data } = await db.from("planner_followups").select("id").eq("profile_id", profileId).eq("occurrence_date", today).not("duration_feel", "is", null).limit(1);
  return Boolean(data?.length);
}

/** د.4/د.7: بدء التالي. خلال transition_minutes من آخر «تمّت» ⇒ XP transition_started (حد 3) وF1 عند L2+ بقراره هو. «وقت راحة» لا دليل. */
export async function startTransition(db: Db, admin: Db | null, p: Profile, i: { fromFollowupId: string | null; nextKind: "task" | "block" | "habit" | "mission" | "rest"; nextItemId: string | null; suggestedBy: "app" | "user"; transitionMin: number; now?: Date }): Promise<{ xp: number; f1: boolean; transitionId: string | null }> {
  const now = i.now ?? new Date();
  const { data: tr, error } = await db.from("planner_transitions").insert({ profile_id: p.id, from_followup_id: i.fromFollowupId, next_kind: i.nextKind, next_item_id: i.nextItemId, suggested_by: i.suggestedBy, started_at: now.toISOString() }).select("id").single();
  if (error) return { xp: 0, f1: false, transitionId: null };
  if (i.nextKind === "rest" || !admin) return { xp: 0, f1: false, transitionId: tr.id as string };
  const { data: last } = await db.from("planner_followups").select("answered_at").eq("profile_id", p.id).eq("status", "done").not("answered_at", "is", null).order("answered_at", { ascending: false }).limit(1);
  const lastDone = ((last ?? [])[0] as { answered_at: string } | undefined)?.answered_at;
  if (!lastDone || !transitionStarted(new Date(lastDone), now, i.transitionMin)) return { xp: 0, f1: false, transitionId: tr.id as string };
  const xp = await awardPlannerXp(admin, p.id, "transition_started", tr.id as string, now);
  let f1 = false;
  if (i.suggestedBy === "user") {
    const idx = await supportIndexFor(admin, p.id, followupConfig.evidence.F1.capability as "self_control", p.age_mode);
    const v = f1Value(true, idx, SUPPORT_LEVELS.indexOf(followupConfig.evidence.F1.min_support_level as (typeof SUPPORT_LEVELS)[number]));
    if (v !== null) f1 = await recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: "F1", capability: "self_control", type: "strategy_fit", source: "auto", value: v, dedupeKey: tr.id as string, ruleWeight: followupConfig.evidence.F1.rule_weight }, now);
  }
  return { xp, f1, transitionId: tr.id as string };
}

/** د.4: بطاقة «الحين والتالي» لليوم. */
export async function nextCardFor(db: Db, p: Profile, now: Date, weekStart: WeekStart, o: { quietNow: boolean; windDownNow: boolean; supportBand: "L0_L1" | "L2_L3"; restSuppressedUntil: Date | null; remainingPriorities: Array<{ id: string | null; text: string }>; prioritiesTotal: number }): Promise<{ decision: NextDecision; soon: ScheduledItem | null; settings: FollowupSettings }> {
  const s = await followupSettings(db, p.id);
  const today = localParts(now, p.timezone).date;
  const items = await scheduledFor(db, p, today, s, weekStart);
  const { data: done } = await db.from("planner_followups").select("item_kind, item_id").eq("profile_id", p.id).eq("occurrence_date", today).in("status", ["done", "missed", "postponed"]);
  const closed = new Set(((done ?? []) as Array<{ item_kind: string; item_id: string }>).map((d) => `${d.item_kind}:${d.item_id}`));
  const open = items.filter((it) => !closed.has(`${it.kind}:${it.id}`));
  const decision = nextCard({ now, items: open, remainingPriorities: o.remainingPriorities, prioritiesTotal: o.prioritiesTotal, freeGapMin: s.freeGapMin, upcomingSoonMin: s.upcomingSoonMin, quietNow: o.quietNow, windDownNow: o.windDownNow, restSuppressedUntil: o.restSuppressedUntil, supportBand: o.supportBand });
  return { decision, soon: upcomingSoon(open, now, s.upcomingSoonMin), settings: s };
}

export type { PlannerTaskRow };
