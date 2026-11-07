/**
 * العادات (0.4 ب.7 + د.2) — قواعد نقية: الجدول (يومي، أيام محددة، N مرات أسبوعيًا، ووقت ومدة اختياريان)،
 * نسبة الالتزام الأسبوعية (المؤشر الرئيسي)، السلسلة بلا عقوبة مع أيام مرنة، أفضل سلسلة.
 */
import { addDays, weekdayOf, workdays, type WeekStart } from "./recurrence";

export type HabitSchedule =
  | { kind: "daily"; time_local?: string | null; duration_min?: number | null }
  | { kind: "weekdays_set"; days: number[]; time_local?: string | null; duration_min?: number | null }
  | { kind: "times_per_week"; times: number; time_local?: string | null; duration_min?: number | null };

export type Checkin = { date: string; done: boolean; flex_used: boolean };

/** هل العادة مجدولة في هذا اليوم؟ (times_per_week: أي يوم مؤهل) */
export function scheduledOn(s: HabitSchedule, date: string, weekStart: WeekStart): boolean {
  if (s.kind === "daily" || s.kind === "times_per_week") return true;
  const d = weekdayOf(date);
  return s.days.length ? s.days.includes(d) : workdays(weekStart).includes(d);
}

/** بداية الأسبوع المحلي الذي يحوي التاريخ. */
export function weekStartOf(date: string, weekStart: WeekStart): string {
  const startIdx = weekStart === "sun" ? 0 : weekStart === "mon" ? 1 : 6;
  let d = date;
  while (weekdayOf(d) !== startIdx) d = addDays(d, -1);
  return d;
}

/** نسبة الالتزام في أسبوع: المنجز ÷ المطلوب (times_per_week: المنجز ÷ times). */
export function weeklyAdherence(s: HabitSchedule, checkins: Checkin[], weekStartDate: string, weekStart: WeekStart, upTo?: string): number {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i)).filter((d) => !upTo || d <= upTo);
  const done = new Set(checkins.filter((c) => c.done).map((c) => c.date));
  if (s.kind === "times_per_week") {
    const n = days.filter((d) => done.has(d)).length;
    return Math.min(1, s.times > 0 ? n / s.times : 0);
  }
  const due = days.filter((d) => scheduledOn(s, d, weekStart));
  if (due.length === 0) return 0;
  return due.filter((d) => done.has(d)).length / due.length;
}

export type StreakResult = { current: number; best: number; flexUsedThisWeek: number };

/**
 * السلسلة بلا عقوبة: يوم مرن (حتى flexPerWeek أسبوعيًا) لا يكسرها. عند الانقطاع تبدأ من جديد بهدوء، وأفضل سلسلة تبقى.
 * تُحسب على الأيام المجدولة فقط حتى اليوم (today).
 */
export function streak(s: HabitSchedule, checkins: Checkin[], flexPerWeek: number, from: string, today: string, weekStart: WeekStart): StreakResult {
  const done = new Set(checkins.filter((c) => c.done).map((c) => c.date));
  let current = 0, best = 0, flexUsed = 0, weekKey = "";
  for (let d = from; d <= today; d = addDays(d, 1)) {
    if (!scheduledOn(s, d, weekStart)) continue;
    const wk = weekStartOf(d, weekStart);
    if (wk !== weekKey) { weekKey = wk; flexUsed = 0; }
    if (done.has(d)) { current++; }
    else if (d === today) { /* اليوم لم ينتهِ بعد؛ لا يكسر */ }
    else if (flexUsed < flexPerWeek) { flexUsed++; }
    else { current = 0; }
    best = Math.max(best, current);
  }
  return { current, best, flexUsedThisWeek: weekKey === weekStartOf(today, weekStart) ? flexUsed : 0 };
}

/** "7 أيام عادة": N أيام التزام متتالية (مع احتساب الأيام المرنة) (ب.8). */
export function habitDaysReached(result: StreakResult, days: number): boolean { return result.current >= days; }

/** محفز habit_consistency (ب.8): نسبة التزام ≥ rate لمدة weeks أسابيع متتالية (الأسبوع الحالي غير مكتمل لا يُحتسب). */
export function habitConsistency(s: HabitSchedule, checkins: Checkin[], today: string, weekStart: WeekStart, minRate: number, weeks: number): boolean {
  const thisWeek = weekStartOf(today, weekStart);
  for (let i = 1; i <= weeks; i++) {
    const ws = addDays(thisWeek, -7 * i);
    if (weeklyAdherence(s, checkins, ws, weekStart) < minRate) return false;
  }
  return true;
}
