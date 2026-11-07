/**
 * ترتيب اليوم الحتمي (0.4 ب.10 day_planner — الاحتياطي والتحقق). L0–L1: ترتيب كامل حسب الأولوية والاستحقاق والتقدير
 * والنوافذ الحرة. L2–L3: المستخدم يختار أهم 1–3 ثم تُقترح أماكنها فقط. أوقات محلية بالدقائق.
 */
import { planner, type PlannerPriority } from "@/shared/config";

type DPCfg = { L0_L1: { mode: string }; L2_L3: { mode: string; top_pick_range: [number, number] }; defaults: { day_end: string; default_estimate_min: number; buffer_min: number } };
export const dayPlannerConfig = (planner.ai as unknown as { day_planner: DPCfg }).day_planner;
const PRIO: Record<PlannerPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };

export type PlanTask = { id: string; priority: PlannerPriority; due_date: string | null; due_time: string | null; estimate_min: number | null };
export type Busy = { start: number; end: number };
export type Placement = { task_id: string; start: string; end: string };

export const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const est = (t: PlanTask) => t.estimate_min ?? dayPlannerConfig.defaults.default_estimate_min;

/** ترتيب الأولوية: مواعيد ثابتة أولًا ثم المتأخر/المستحق اليوم، ثم الأولوية، ثم الأقصر. */
export function orderTasks(tasks: PlanTask[], today: string): PlanTask[] {
  const dueRank = (t: PlanTask) => (t.due_date && t.due_date <= today ? 0 : t.due_date ? 1 : 2);
  return [...tasks].sort((a, b) => dueRank(a) - dueRank(b) || PRIO[a.priority] - PRIO[b.priority] || est(a) - est(b) || a.id.localeCompare(b.id));
}

/** يضع المهام في النوافذ الحرة من الآن حتى نهاية اليوم؛ المهمة ذات الوقت تبقى في وقتها. ما لا يتسع لا يوضع. */
export function placeTasks(tasks: PlanTask[], i: { nowMin: number; busy: Busy[]; dayEnd?: string }): Placement[] {
  const end = toMin(i.dayEnd ?? dayPlannerConfig.defaults.day_end), buf = dayPlannerConfig.defaults.buffer_min;
  const taken: Busy[] = [...i.busy];
  const out: Placement[] = [];
  const overlaps = (s: number, e: number) => taken.some((b) => s < b.end && e > b.start);
  for (const t of tasks.filter((x) => x.due_time)) { const s = toMin(t.due_time!.slice(0, 5)), e = s + est(t); out.push({ task_id: t.id, start: hhmm(s), end: hhmm(e) }); taken.push({ start: s, end: e }); }
  for (const t of tasks.filter((x) => !x.due_time)) {
    let s = i.nowMin;
    while (s + est(t) <= end && overlaps(s, s + est(t))) { const blocker = taken.filter((b) => s < b.end && s + est(t) > b.start).sort((a, b) => b.end - a.end)[0]!; s = blocker.end + buf; }
    if (s + est(t) > end) continue;
    out.push({ task_id: t.id, start: hhmm(s), end: hhmm(s + est(t)) }); taken.push({ start: s, end: s + est(t) });
  }
  return out.sort((a, b) => toMin(a.start) - toMin(b.start));
}

export type DayPlanMode = "propose_full_order" | "user_picks_top_then_place";
export function planDay(i: { mode: DayPlanMode; tasks: PlanTask[]; picks?: string[]; today: string; nowMin: number; busy: Busy[] }): { ok: true; placements: Placement[] } | { ok: false; error: "picks_required" } {
  if (i.mode === "user_picks_top_then_place") {
    const [min, max] = dayPlannerConfig.L2_L3.top_pick_range;
    const picks = [...new Set(i.picks ?? [])];
    if (picks.length < min || picks.length > max) return { ok: false, error: "picks_required" };
    return { ok: true, placements: placeTasks(orderTasks(i.tasks.filter((t) => picks.includes(t.id)), i.today), i) };
  }
  return { ok: true, placements: placeTasks(orderTasks(i.tasks, i.today), i) };
}

/** تحقق مخرج النموذج: معرّفات من القائمة (أو من الاختيار عند L2+) بلا تكرار، أوقات صالحة بعد الآن، بلا تداخل مع المشغول. */
export function verifyPlacements(placements: Array<{ task_id: string; start: string }>, i: { allowed: string[]; nowMin: number; busy: Busy[]; tasks: PlanTask[] }): string | null {
  const seen = new Set<string>();
  const taken: Busy[] = [...i.busy];
  for (const p of placements) {
    if (!i.allowed.includes(p.task_id)) return "unknown_task";
    if (seen.has(p.task_id)) return "duplicate_task";
    seen.add(p.task_id);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start)) return "bad_time";
    const t = i.tasks.find((x) => x.id === p.task_id)!;
    const s = toMin(p.start), e = s + est(t);
    if (!t.due_time && s < i.nowMin) return "in_the_past";
    if (taken.some((b) => s < b.end && e > b.start)) return "overlap";
    taken.push({ start: s, end: e });
  }
  return null;
}
