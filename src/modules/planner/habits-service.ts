import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { game, customization } from "@/shared/config";
import { effective } from "@/modules/settings";
import { award } from "@/modules/game/service";
import { addDays, type WeekStart } from "./recurrence";
import { streak, weeklyAdherence, weekStartOf, scheduledOn, habitDaysReached, type HabitSchedule, type Checkin } from "./habits";
import { awardPlannerXp } from "./xp-service";

type Db = SupabaseClient;
export type HabitRow = { id: string; profile_id: string; title: string; schedule: HabitSchedule; capability_id: string | null; flex_days_per_week: number; archived: boolean; created_at: string };
export type HabitView = HabitRow & { adherence: number; current: number; best: number; doneToday: boolean; scheduledToday: boolean };

export async function createHabit(db: Db, i: { profileId: string; title: string; schedule: HabitSchedule; capabilityId?: string | null; flexDays?: number | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const flex = i.flexDays ?? ((await effective<number>(db, i.profileId, "habit_flex_days_per_week")).value);
  const { data, error } = await db.from("planner_habits").insert({ profile_id: i.profileId, title: i.title.trim(), schedule: i.schedule, capability_id: i.capabilityId ?? null, flex_days_per_week: flex }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** تسجيل يومي بلمسة (ب.7). XP habit_checkin بحد 3 يوميًا، وإنجاز «7 أيام عادة» عند بلوغه. */
export async function checkinHabit(db: Db, admin: Db | null, i: { habitId: string; profileId: string; date: string; done?: boolean; weekStart: WeekStart; now?: Date }): Promise<{ ok: boolean; streak: number; xp: number; achievement: boolean }> {
  const { error } = await db.from("planner_habit_checkins").upsert({ habit_id: i.habitId, date: i.date, done: i.done ?? true }, { onConflict: "habit_id,date" });
  if (error) return { ok: false, streak: 0, xp: 0, achievement: false };
  const view = await habitView(db, i.habitId, i.date, i.weekStart);
  let xp = 0, achievement = false;
  if (admin && (i.done ?? true)) {
    xp = await awardPlannerXp(admin, i.profileId, "habit_checkin", `${i.habitId}:${i.date}`, i.now);
    if (view && habitDaysReached({ current: view.current, best: view.best, flexUsedThisWeek: 0 }, game.achievements.habit_7_days.days)) achievement = await award(admin, i.profileId, "habit_7_days", 1, i.habitId, null);
  }
  return { ok: true, streak: view?.current ?? 0, xp, achievement };
}

export async function habitView(db: Db, habitId: string, today: string, weekStart: WeekStart): Promise<HabitView | null> {
  const { data: h } = await db.from("planner_habits").select("*").eq("id", habitId).maybeSingle();
  if (!h) return null;
  const row = h as HabitRow;
  const { data: ci } = await db.from("planner_habit_checkins").select("date, done, flex_used").eq("habit_id", habitId);
  const checkins = (ci ?? []) as Checkin[];
  const s = streak(row.schedule, checkins, row.flex_days_per_week, row.created_at.slice(0, 10), today, weekStart);
  return { ...row, adherence: weeklyAdherence(row.schedule, checkins, weekStartOf(today, weekStart), weekStart, today), current: s.current, best: s.best, doneToday: checkins.some((c) => c.date === today && c.done), scheduledToday: scheduledOn(row.schedule, today, weekStart) };
}

export async function listHabits(db: Db, profileId: string, today: string, weekStart: WeekStart): Promise<HabitView[]> {
  const { data } = await db.from("planner_habits").select("id").eq("profile_id", profileId).eq("archived", false).order("created_at", { ascending: true });
  const out: HabitView[] = [];
  for (const r of (data ?? []) as Array<{ id: string }>) { const v = await habitView(db, r.id, today, weekStart); if (v) out.push(v); }
  return out;
}

/** هـ.5: اقتراح عادة «نوم الساعة X» بيوم مرن أسبوعي عند ضبط target_bedtime لأول مرة. */
export async function suggestBedtimeHabit(db: Db, profileId: string, bedtime: string): Promise<boolean> {
  const { data } = await db.from("planner_habits").select("id").eq("profile_id", profileId).contains("schedule", { kind: "daily", bedtime: true }).limit(1);
  if (data?.length) return false;
  const flex = customization.catalog.habit_flex_days_per_week!.default.adult as number;
  const r = await createHabit(db, { profileId, title: `نوم الساعة ${bedtime}`, schedule: { kind: "daily", time_local: bedtime, duration_min: null, bedtime: true } as unknown as HabitSchedule, flexDays: flex });
  return r.ok;
}
export const lastWeekStart = (today: string, ws: WeekStart) => addDays(weekStartOf(today, ws), -7);
