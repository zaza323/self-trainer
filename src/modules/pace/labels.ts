/** نصوص الوتيرة (ح.6): مقارنة بالنفس فقط، الانخفاض بلغة محايدة مع سؤال واحد، الزيادة بلغة بسيطة للطفل. */
import type { AgeMode } from "@/shared/config";
import content from "@content/pace.ar.json";
import { compareSelf } from "./rules";

export const paceContent = content;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const PERCENT = new Set(["follow_through", "bedtime_adherence"]);

export function metricLabel(metric: string, habitTitles: Record<string, string> = {}): string {
  if (metric.startsWith("habit_adherence:")) return fill(content.metrics.habit_adherence, { title: habitTitles[metric.split(":")[1] ?? ""] ?? "" });
  return (content.metrics as Record<string, string>)[metric] ?? metric;
}
export function formatValue(metric: string, v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  if (PERCENT.has(metric) || metric.startsWith("habit_adherence")) return `${Math.round(v * 100)}%`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
/** سطر المقارنة: «صرت X بعد ما كانت Y» / ثابت / انخفاض محايد بسؤال واحد. */
export function compareLine(metric: string, before: number | null, now: number | null): string | null {
  const dir = compareSelf(before, now);
  const v = { now: formatValue(metric, now), then: formatValue(metric, before) };
  if (dir === "up") return fill(content.rise, v);
  if (dir === "down") return fill(content.decline, v);
  if (dir === "same") return fill(content.same, v);
  return null;
}
export type IncrementLike = { kind: string; metric: string | null; from_value: number | string | null; target_value: number | string | null; description: string | null };
export function incrementText(inc: IncrementLike, mode: AgeMode, habitTitles: Record<string, string> = {}): string {
  const table = (mode === "child" ? content.child_kinds : content.kinds) as Record<string, string>;
  const metric = inc.metric ? metricLabel(inc.metric, habitTitles) : "";
  const num = (x: number | string | null) => (x === null ? "" : formatValue(inc.metric ?? "", Number(x)));
  return fill(table[inc.kind] ?? inc.kind, { metric, from: num(inc.from_value), target: num(inc.target_value), title: inc.description ?? "", text: inc.description ?? "" });
}
export function lastIncrementLine(inc: IncrementLike & { achieved_days: number | null; window_days: number | null }, mode: AgeMode, habitTitles: Record<string, string> = {}): string {
  return fill(content.review.last, { desc: incrementText(inc, mode, habitTitles), n: inc.achieved_days ?? 0, d: inc.window_days ?? 0 });
}
