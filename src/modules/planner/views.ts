/** العروض الأساسية (0.4 ب.3): اليوم، القادم (N أيام)، المتأخر، المنجز، القائمة — دوال نقية على صفوف المهام. */
import { planner, type PlannerPriority } from "@/shared/config";
import { addDays } from "./recurrence";
import type { PlannerTaskRow } from "./types";

export type PlannerView = "today" | "upcoming" | "overdue" | "done" | "list";
export const PLANNER_VIEWS = planner.tasks.views as string[];

const PRIORITY_RANK: Record<PlannerPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };

export function sortOpen(a: PlannerTaskRow, b: PlannerTaskRow): number {
  const ad = a.due_date ?? "9999-12-31", bd = b.due_date ?? "9999-12-31";
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.due_time ?? "99:99", bt = b.due_time ?? "99:99";
  if (at !== bt) return at < bt ? -1 : 1;
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  return a.created_at < b.created_at ? -1 : 1;
}

export function isOverdue(t: PlannerTaskRow, today: string): boolean {
  return t.status === "open" && t.due_date !== null && t.due_date < today;
}

/** يصنّف المهام (الأصول فقط؛ الفرعية تتبع أبويها) حسب العرض. */
export function groupTasks(tasks: PlannerTaskRow[], today: string): Record<PlannerView, PlannerTaskRow[]> {
  const roots = tasks.filter((t) => !t.parent_task_id);
  const open = roots.filter((t) => t.status === "open").sort(sortOpen);
  const horizon = addDays(today, planner.tasks.upcoming_days);
  return {
    today: open.filter((t) => t.due_date === today),
    upcoming: open.filter((t) => t.due_date !== null && t.due_date > today && t.due_date <= horizon),
    overdue: open.filter((t) => isOverdue(t, today)),
    done: roots.filter((t) => t.status === "done").sort((a, b) => ((a.completed_at ?? "") > (b.completed_at ?? "") ? -1 : 1)),
    list: open,
  };
}

export type SavedFilterQuery = { priority?: PlannerPriority[]; tag_ids?: string[]; project_id?: string | null; status?: Array<"open" | "done" | "cancelled">; from?: string | null; to?: string | null };

/** تطبيق فلتر محفوظ (ب.3): شروط على الأولوية والوسم والمشروع ونطاق التاريخ والحالة. */
export function applyFilter(tasks: PlannerTaskRow[], q: SavedFilterQuery, tagsByTask: Map<string, string[]>): PlannerTaskRow[] {
  return tasks.filter((t) => {
    if (q.priority?.length && !q.priority.includes(t.priority)) return false;
    if (q.status?.length && !q.status.includes(t.status)) return false;
    if (q.project_id && t.project_id !== q.project_id) return false;
    if (q.from && (!t.due_date || t.due_date < q.from)) return false;
    if (q.to && (!t.due_date || t.due_date > q.to)) return false;
    if (q.tag_ids?.length) { const mine = tagsByTask.get(t.id) ?? []; if (!q.tag_ids.some((id) => mine.includes(id))) return false; }
    return true;
  });
}
