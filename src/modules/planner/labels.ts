/** تسميات العرض من content/planner.ar.json (آمنة للعميل). */
import content from "@content/planner.ar.json";
import type { Recurrence } from "./recurrence";

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

export function recurrenceLabel(r: Recurrence | null, recurFrom: "schedule" | "completion" | null = null): string {
  const c = content.recurrence;
  if (!r) return c.none;
  let s: string;
  switch (r.kind) {
    case "daily": s = c.daily; break;
    case "weekly": s = fill(c.weekly, { days: r.byday.map((d) => content.weekdays[d]).join("، ") }); break;
    case "weekdays": s = c.weekdays; break;
    case "every_n_days": s = fill(c.every_n_days, { n: r.n }); break;
    case "monthly_day": s = fill(c.monthly_day, { day: r.day }); break;
  }
  if (recurFrom === "completion") s += ` (${c.from_completion})`;
  return s;
}

export function reminderOffsetLabel(offsetMin: number): string {
  const c = content.reminder;
  if (offsetMin === 0) return c.at_due;
  if (offsetMin % 1440 === 0) return fill(c.before_days, { d: offsetMin / 1440 });
  if (offsetMin % 60 === 0) return fill(c.before_hours, { h: offsetMin / 60 });
  return fill(c.before, { min: offsetMin });
}

export function priorityLabel(p: keyof typeof content.priority): string { return content.priority[p]; }
export const plannerContent = content;
export { fill as fillLabel };
