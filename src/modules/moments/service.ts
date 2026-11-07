import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { game, type AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { localParts, inQuietHours, instantForLocal, type TimeRange } from "@/modules/notifications/plan";
import { addDays, type WeekStart } from "@/modules/planner/recurrence";
import { listTasks } from "@/modules/planner/service";
import { groupTasks } from "@/modules/planner/views";
import { awardPlannerXp } from "@/modules/planner/xp-service";
import { recordPlannerEvidence } from "@/modules/planner/evidence-service";
import { d1Value, d3Value } from "@/modules/planner/evidence-values";
import { inWindDown } from "@/modules/rest/suggest";
import { chooseOpener, renderOpener, rotationFor, replyMomentFor, deadlineCardsMax, fadeSuggestAt, effectiveMoments, type OpenerDecision, type MomentKey, type CheckinStatus } from "./openers";
import type { PlannerTaskRow } from "@/modules/planner/types";

type Db = SupabaseClient;
export type Profile = { id: string; user_id: string; age_mode: AgeMode; timezone: string; display_name: string };
export type CheckinRow = { id: string; profile_id: string; local_date: string; moment: MomentKey; status: CheckinStatus; shown_at: string; answered_at: string | null; top_priorities: Array<{ task_id: string | null; text: string }>; session_id: string | null };

export type MomentSettings = { startScreen: string; enabled: string[]; windows: Record<string, [string, string]>; push: boolean; lookaheadHours: number; urgentHours: number; quiet: TimeRange | null; breakMode: boolean; bedtime: string | null; windDownMin: number };

export async function momentSettings(db: Db, profileId: string): Promise<MomentSettings> {
  const [start, en, win, push, look, urg, quiet, brk, bed, wd] = await Promise.all([
    effective<string>(db, profileId, "start_screen"), effective<string[]>(db, profileId, "daily_moments_enabled"), effective<Record<string, [string, string]>>(db, profileId, "moment_windows"),
    effective<boolean>(db, profileId, "daily_moments_push"), effective<number>(db, profileId, "deadline_lookahead_hours"), effective<number>(db, profileId, "deadline_urgent_hours"),
    effective<TimeRange | null>(db, profileId, "quiet_hours"), effective<boolean>(db, profileId, "break_mode"), effective<string | null>(db, profileId, "target_bedtime"), effective<number>(db, profileId, "wind_down_minutes"),
  ]);
  return { startScreen: start.value, enabled: en.value, windows: win.value, push: push.value, lookaheadHours: look.value, urgentHours: urg.value, quiet: quiet.value ?? null, breakMode: brk.value, bedtime: bed.value, windDownMin: wd.value };
}

export async function checkinsOn(db: Db, profileId: string, date: string): Promise<CheckinRow[]> {
  const { data } = await db.from("daily_checkins").select("*").eq("profile_id", profileId).eq("local_date", date);
  return (data ?? []) as CheckinRow[];
}

/** أولويات اليوم: من لحظة الصباح، وإلا من خطة الليل (المحاسبة أو night_plan) ليوم أمس. */
export function todaysPriorities(todayRows: CheckinRow[], yesterdayRows: CheckinRow[]): Array<{ task_id: string | null; text: string }> {
  const morning = todayRows.find((c) => c.moment === "morning_plan" && c.status === "answered");
  if (morning?.top_priorities.length) return morning.top_priorities;
  const night = yesterdayRows.find((c) => (c.moment === "night_plan" || c.moment === "muhasaba") && c.status === "answered");
  return night?.top_priorities ?? [];
}

export type DeadlineCard = { task: PlannerTaskRow; hoursLeft: number };

/** مواعيد خلال lookahead (بحد 3)، وأقربها العاجل (أولوية عالية أو «مهم») خلال urgent_hours (ج.4). */
export function deadlineCards(tasks: PlannerTaskRow[], now: Date, tz: string, lookaheadHours: number, urgentHours: number): { cards: DeadlineCard[]; urgent: DeadlineCard | null } {
  const cards: DeadlineCard[] = [];
  for (const t of tasks) {
    if (t.status !== "open" || !t.due_date) continue;
    const due = instantForLocal(t.due_date, (t.due_time ?? "23:59").slice(0, 5), tz);
    const hoursLeft = (due.getTime() - now.getTime()) / 3600000;
    if (hoursLeft >= 0 && hoursLeft <= lookaheadHours) cards.push({ task: t, hoursLeft });
  }
  cards.sort((a, b) => a.hoursLeft - b.hoursLeft);
  const urgent = cards.find((c) => (c.task.priority === "high" || c.task.important) && c.hoursLeft <= urgentHours) ?? null;
  return { cards: cards.slice(0, deadlineCardsMax), urgent };
}

export type StartScreenFacts = {
  decision: OpenerDecision; openerText: string; replyMoment: string | null;
  todayCount: number; overdueCount: number; topToday: PlannerTaskRow[]; deadlines: DeadlineCard[]; priorities: Array<{ task_id: string | null; text: string }>;
  settings: MomentSettings; quietNow: boolean; windDownNow: boolean; today: string; nowMin: number;
};

/** P35: حقائق شاشة البداية حتميًا بلا ذكاء اصطناعي (ج.7). يسجّل «shown» للحظة المختارة (مرة واحدة يوميًا). */
export async function loadStartScreen(db: Db, p: Profile, i: { now: Date; safetyPending: boolean; comeback: boolean; followupsPending: number }): Promise<StartScreenFacts> {
  const s = await momentSettings(db, p.id);
  const lp = localParts(i.now, p.timezone);
  const today = lp.date;
  const [tasks, todayRows, yRows] = await Promise.all([listTasks(db, p.id), checkinsOn(db, p.id, today), checkinsOn(db, p.id, addDays(today, -1))]);
  const groups = groupTasks(tasks, today);
  const { cards, urgent } = deadlineCards(tasks, i.now, p.timezone, s.lookaheadHours, s.urgentHours);
  const quietNow = inQuietHours(lp.minutes, s.quiet);
  const windDownNow = inWindDown(lp.minutes, s.bedtime, s.windDownMin);
  const checkinsToday: Partial<Record<MomentKey, CheckinStatus>> = {};
  for (const c of todayRows) checkinsToday[c.moment] = c.status;
  const nightPlan = yRows.find((c) => (c.moment === "night_plan" || c.moment === "muhasaba") && c.status === "answered" && c.top_priorities.length > 0);
  const decision = chooseOpener({
    ageMode: p.age_mode, nowMin: lp.minutes, breakMode: s.breakMode, safetyPending: i.safetyPending, comeback: i.comeback, followupsPending: i.followupsPending,
    deadlineSoon: urgent ? { title: urgent.task.title, dueLabel: urgent.task.due_time?.slice(0, 5) ?? "" } : null,
    enabledMoments: s.enabled, windows: s.windows, tokens: { quietStart: s.quiet?.[0] ?? null, windDownStart: s.bedtime ? minutesToHHMM((parseHHMM(s.bedtime) - s.windDownMin + 1440) % 1440) : null },
    checkinsToday, nightPlanExists: Boolean(nightPlan), quietNow, hasAnyTasks: tasks.some((t) => t.status === "open"),
  });
  const priorities = todaysPriorities(todayRows, yRows);
  const doneIds = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  const vars = { name: p.display_name, today_count: groups.today.length, overdue_count: groups.overdue.length, top_deadline: urgent?.task.title ?? cards[0]?.task.title ?? "", top_priorities: priorities.map((x) => x.text).join("، "), schedule: groups.today.filter((t) => t.due_time).map((t) => `${t.title} ${t.due_time!.slice(0, 5)}`).join("، "), done_count: priorities.filter((x) => x.task_id && doneIds.has(x.task_id)).length, planned_count: priorities.length };
  let openerText = "", replyMoment: string | null = null;
  if (decision.kind === "moment") {
    openerText = renderOpener(decision.confirm ? "morning_confirm" : decision.moment, p.age_mode, vars, rotationFor(today));
    replyMoment = replyMomentFor(decision.moment, decision.confirm);
    if (!checkinsToday[decision.moment]) await db.from("daily_checkins").upsert({ profile_id: p.id, local_date: today, moment: decision.moment, status: "shown" }, { onConflict: "profile_id,local_date,moment", ignoreDuplicates: true });
  } else if (decision.kind === "deadline") openerText = renderOpener("deadline_soon", p.age_mode, vars, rotationFor(today));
  else if (decision.kind === "light") openerText = renderOpener("light", p.age_mode, vars, rotationFor(today));
  else if (decision.kind === "no_tasks") openerText = renderOpener("no_tasks", p.age_mode, vars, rotationFor(today));
  return { decision, openerText, replyMoment, todayCount: groups.today.length, overdueCount: groups.overdue.length, topToday: groups.today.slice(0, 3), deadlines: cards, priorities, settings: s, quietNow, windDownNow, today, nowMin: lp.minutes };
}

function parseHHMM(s: string): number { const [h, m] = s.split(":").map(Number); return h! * 60 + m!; }
function minutesToHHMM(m: number): string { return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

/** «مش هلق»: يخفي اللحظة حتى نهاية نافذتها (ج.5). */
export async function dismissMoment(db: Db, profileId: string, date: string, moment: MomentKey): Promise<void> {
  await db.from("daily_checkins").upsert({ profile_id: profileId, local_date: date, moment, status: "dismissed" }, { onConflict: "profile_id,local_date,moment" });
}

/**
 * الإجابة: أولويات (صباح/ليل/تأكيد) أو تأمل مسائي. تُحفظ بكلمات المستخدم في daily_checkins وفي جلسة مرافق daily_moment.
 * XP: daily_plan_set (مرة يوميًا) للصباح/الليل، evening_review_done للمساء.
 */
export async function answerMoment(db: Db, admin: Db | null, p: Profile, i: { date: string; moment: MomentKey; priorities?: Array<{ task_id: string | null; text: string }>; text?: string | null; confirm?: boolean; now?: Date }): Promise<{ ok: boolean; xp: number }> {
  const now = i.now ?? new Date();
  const { data: sess } = await db.from("companion_sessions").insert({ profile_id: p.id, mode: "daily_moment", daily_moment: i.moment }).select("id").single();
  const sessionId = (sess?.id as string | undefined) ?? null;
  if (sessionId && i.text) await db.from("companion_messages").insert({ session_id: sessionId, role: "player", author_id: p.user_id, content: i.text, moment: i.moment === "evening_review" ? "reflection_core" : "priority_pick", input_method: "typed" });
  const priorities = (i.priorities ?? []).slice(0, 3);
  const { error } = await db.from("daily_checkins").upsert({ profile_id: p.id, local_date: i.date, moment: i.moment, status: "answered", answered_at: now.toISOString(), top_priorities: priorities, session_id: sessionId }, { onConflict: "profile_id,local_date,moment" });
  if (error) return { ok: false, xp: 0 };
  if (sessionId) await db.from("companion_sessions").update({ ended_at: now.toISOString(), summary: priorities.map((x) => x.text).join("، ") || i.text || null }).eq("id", sessionId);
  let xp = 0;
  if (admin) {
    if ((i.moment === "morning_plan" || i.moment === "night_plan") && priorities.length) xp = await awardPlannerXp(admin, p.id, "daily_plan_set", `${p.id}:${i.moment === "night_plan" ? addDays(i.date, 1) : i.date}`, now);
    if (i.moment === "evening_review") { xp = await awardPlannerXp(admin, p.id, "evening_review_done", `${p.id}:${i.date}`, now); await evaluateDayPlanEvidence(admin, p, i.date, now); }
  }
  return { ok: true, xp };
}

/** ج.8: D1 (أولويات اليوم) وD3 (خطة ليلية ثم إنجاز غدًا) — بلا قيمة سلبية، ضمن حد 3 يوميًا لكل قدرة. تُستدعى في المساء أو نهاية اليوم (idempotent). */
export async function evaluateDayPlanEvidence(admin: Db, p: Profile, date: string, now = new Date()): Promise<{ d1: boolean; d3: boolean }> {
  const [todayRows, yRows] = await Promise.all([checkinsOn(admin, p.id, date), checkinsOn(admin, p.id, addDays(date, -1))]);
  const { data: doneRows } = await admin.from("planner_tasks").select("id").eq("profile_id", p.id).eq("status", "done");
  const { data: fRows } = await admin.from("planner_followups").select("item_id").eq("profile_id", p.id).eq("occurrence_date", date).eq("status", "done");
  const done = new Set([...((doneRows ?? []) as Array<{ id: string }>).map((x) => x.id), ...((fRows ?? []) as Array<{ item_id: string }>).map((x) => x.item_id)]);
  const countDone = (ps: Array<{ task_id: string | null; text: string }>) => ps.filter((x) => x.task_id && done.has(x.task_id)).length;
  let d1 = false, d3 = false;
  const morning = todayRows.find((c) => c.moment === "morning_plan" && c.status === "answered" && c.top_priorities.length);
  const night = yRows.find((c) => (c.moment === "night_plan" || c.moment === "muhasaba") && c.status === "answered" && c.top_priorities.length);
  const planned = morning ?? night;
  if (planned) { const v = d1Value(planned.top_priorities.length, countDone(planned.top_priorities)); if (v !== null) d1 = await recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: "D1", capability: "planning", type: "strategy_fit", source: "auto", value: v, dedupeKey: date }, now); }
  if (night) { const v = d3Value(night.top_priorities.length, countDone(night.top_priorities)); if (v !== null) d3 = await recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: "D3", capability: "self_awareness", type: "prediction_accuracy", source: "auto", value: v, dedupeKey: date }, now); }
  return { d1, d3 };
}

/** ج.5 التلاشي: عند avg_support ≥ 2 اقتراح واحد (إشعار داخل التطبيق) بتخفيف اللحظات؛ المستخدم يقرر ولا تُطفأ تلقائيًا. */
export async function maybeSuggestFade(admin: Db, profileId: string, avgSupport: number): Promise<boolean> {
  if (avgSupport < fadeSuggestAt) return false;
  const { data } = await admin.from("notifications").upsert({ profile_id: profileId, type: "daily_moments_fade", dedupe_key: `daily_moments_fade:${profileId}`, payload: {} }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  return Boolean(data?.length);
}
export const activeCapabilityMinConfidence = game.incentive_stages.active_capability_min_confidence;
export type { WeekStart };

/** ج.6: اللحظات التي يُرسل لها إشعار اختياري (المحاسبة تحل محل المساء والليل). */
export const effectiveMomentsForPush = effectiveMoments;
