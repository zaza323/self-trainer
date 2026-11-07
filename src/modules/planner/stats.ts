/** الإحصائيات (0.4 ب.9) — حسابات نقية من المهام وجلسات التركيز والعادات. لا مقارنة بالآخرين. */
import type { PlannerTaskRow } from "./types";
import { addDays } from "./recurrence";

export type FocusRow = { started_at: string; minutes: number; completed: boolean };

export function weeklyCompletionRate(tasks: PlannerTaskRow[], weekStartDate: string): number {
  const end = addDays(weekStartDate, 7);
  const inWeek = tasks.filter((t) => t.due_date && t.due_date >= weekStartDate && t.due_date < end && t.status !== "cancelled");
  if (inWeek.length === 0) return 0;
  return inWeek.filter((t) => t.status === "done").length / inWeek.length;
}

/** أكثر الساعات إنتاجية: من المنجز ودقائق التركيز، بالساعة المحلية (0..23). */
export function productiveHours(tasks: PlannerTaskRow[], focus: FocusRow[], tz: string, top = 3): Array<{ hour: number; score: number }> {
  const score = new Map<number, number>();
  const hourOf = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  for (const t of tasks) if (t.status === "done" && t.completed_at) score.set(hourOf(t.completed_at), (score.get(hourOf(t.completed_at)) ?? 0) + 1);
  for (const f of focus) score.set(hourOf(f.started_at), (score.get(hourOf(f.started_at)) ?? 0) + f.minutes / 25);
  return [...score.entries()].map(([hour, s]) => ({ hour, score: Number(s.toFixed(2)) })).sort((a, b) => b.score - a.score).slice(0, top);
}

export function mostPostponed(tasks: PlannerTaskRow[], top = 5): Array<{ id: string; title: string; postpone_count: number }> {
  return tasks.filter((t) => t.postpone_count > 0).sort((a, b) => b.postpone_count - a.postpone_count).slice(0, top).map((t) => ({ id: t.id, title: t.title, postpone_count: t.postpone_count }));
}

/** دقة التقدير عبر الزمن: متوسط |فعلي−مقدّر|/مقدّر لكل أسبوع. */
export function estimateAccuracy(tasks: PlannerTaskRow[], weekStart: (d: string) => string): Array<{ week: string; mean_rel_error: number; n: number }> {
  const buckets = new Map<string, number[]>();
  for (const t of tasks) {
    if (t.status !== "done" || !t.estimate_min || t.actual_min === null || !t.completed_at) continue;
    const wk = weekStart(t.completed_at.slice(0, 10));
    buckets.set(wk, [...(buckets.get(wk) ?? []), Math.abs(t.actual_min - t.estimate_min) / t.estimate_min]);
  }
  return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, xs]) => ({ week, mean_rel_error: Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(3)), n: xs.length }));
}
