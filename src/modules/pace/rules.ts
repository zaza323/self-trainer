/**
 * الوتيرة الشخصية والزيادة (0.4 ح) — قواعد نقية. الأرقام حتمية؛ الذكاء الاصطناعي يصيغ فقط.
 * كل القيم من config/planner.json.pace والإعدادات الفعّالة (pace_stretch_percent، max_active_increments).
 */
import { planner, type AgeMode } from "@/shared/config";

type PaceCfg = {
  baseline: { window_active_days: number; statistic: string; min_active_days: number; recompute: string };
  metrics: string[]; increment_kinds: string[];
  result_thresholds: { advance_at: number; hold_from: number };
  stretch_default_percent: number; min_step_units: number; max_over_baseline_percent: number;
  consolidate: { new_habit_adherence_below: number; weeks: number; blocks_other_increments: boolean };
  morning_priorities_from_pace: { min: number; max: number };
  self_compare_tolerance: number; hard_week_low_days: number; lookback_days: number; self_compare_days_ago: number; evaluation_window_days: number; new_habit_window_days: number;
  achievement: { code: string; consecutive_weeks: number };
};
export const paceConfig = planner.pace as unknown as PaceCfg;

export type IncrementKind = "more" | "longer" | "harder" | "new_habit" | "consolidate" | "hold" | "reallocate";
export type DayMetrics = { date: string; active: boolean; values: Record<string, number | null> };

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** ح.2: خط الأساس = وسيط آخر 14 يومًا نشطًا لكل مؤشر؛ لا خط أساس قبل 7 أيام نشطة. */
export function baselines(days: DayMetrics[]): { sampleDays: number; values: Record<string, number> } | null {
  const active = days.filter((d) => d.active).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, paceConfig.baseline.window_active_days);
  if (active.length < paceConfig.baseline.min_active_days) return null;
  const keys = new Set(active.flatMap((d) => Object.keys(d.values)));
  const values: Record<string, number> = {};
  for (const k of keys) {
    const xs = active.map((d) => d.values[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const m = median(xs);
    if (m !== null) values[k] = Number(m.toFixed(3));
  }
  return { sampleDays: active.length, values };
}

/** ح.4: نتيجة الزيادة السابقة (نسبة الأيام التي حقق فيها الهدف). */
export function incrementOutcome(achievedDays: number, windowDays: number): "achieved" | "held" | "stepped_back" {
  const r = windowDays > 0 ? achievedDays / windowDays : 0;
  if (r >= paceConfig.result_thresholds.advance_at) return "achieved";
  if (r >= paceConfig.result_thresholds.hold_from) return "held";
  return "stepped_back";
}

/** ح.4: الحجم — +stretch% بحد أدنى وحدة، ولا يتجاوز 25% عن خط الأساس (السقف يغلب الحد الأدنى). */
export function nextTarget(baseline: number, stretchPercent: number): number {
  const stretch = baseline * (stretchPercent / 100);
  const raw = baseline + Math.max(stretch, paceConfig.min_step_units);
  const cap = baseline * (1 + paceConfig.max_over_baseline_percent / 100);
  const t = Math.min(raw, cap);
  return Number(Math.max(t, baseline).toFixed(2));
}

/** stretch للبالغ قابل للضبط (5–20)، وثابت (الافتراضي) لغيره. */
export function stretchFor(ageMode: AgeMode, setting: number): number { return ageMode === "adult" ? setting : paceConfig.stretch_default_percent; }

export type NewHabitState = { habitId: string; title: string; createdDaysAgo: number; weeklyAdherence: number[] };

/** عادة جديدة قيد التثبيت: أُنشئت خلال أسابيع التثبيت أو لم تصل 70% أسبوعين. */
export function habitUnderConsolidation(h: NewHabitState): boolean {
  const c = paceConfig.consolidate;
  const lastTwo = h.weeklyAdherence.slice(-c.weeks);
  const consolidated = lastTwo.length >= c.weeks && lastTwo.every((a) => a >= c.new_habit_adherence_below);
  return !consolidated && h.createdDaysAgo <= c.weeks * 7 * 2;
}
export function habitConsolidated(h: NewHabitState): boolean {
  const c = paceConfig.consolidate;
  const lastTwo = h.weeklyAdherence.slice(-c.weeks);
  return lastTwo.length >= c.weeks && lastTwo.every((a) => a >= c.new_habit_adherence_below);
}

export type ProposalInput = {
  ageMode: AgeMode; stretchPercent: number;
  baseline: Record<string, number> | null;
  previous: { kind: IncrementKind; metric: string | null; target: number | null; outcome: "achieved" | "held" | "stepped_back" | null } | null;
  newHabits: NewHabitState[];
  hardWeek: boolean;                      // أسبوع صعب أو ضغط واضح ⇒ hold
};
export type Proposal = { kind: IncrementKind; metric: string | null; from: number | null; target: number | null; habitId?: string | null };

/** ح.3/ح.4: اقتراح واحد حتمي. العادة الجديدة قيد التثبيت هي الزيادة (consolidate إلزامي). */
export function proposeIncrement(i: ProposalInput): Proposal | null {
  if (!i.baseline) return null;                                   // ح.9-1
  const consolidating = i.newHabits.find(habitUnderConsolidation);
  if (consolidating && paceConfig.consolidate.blocks_other_increments) return { kind: "consolidate", metric: `habit_adherence:${consolidating.habitId}`, from: consolidating.weeklyAdherence.at(-1) ?? null, target: paceConfig.consolidate.new_habit_adherence_below, habitId: consolidating.habitId };
  if (i.hardWeek) return { kind: "hold", metric: i.previous?.metric ?? null, from: null, target: i.previous?.target ?? null };
  const prev = i.previous;
  if (prev?.outcome === "held" && prev.metric) return { kind: "hold", metric: prev.metric, from: i.baseline[prev.metric] ?? null, target: prev.target };
  if (prev?.outcome === "stepped_back" && prev.metric) { const b = i.baseline[prev.metric] ?? null; return { kind: "hold", metric: prev.metric, from: b, target: b }; }
  // تقدّم: أولوية للمؤشر التالي في الترتيب بعد السابق (تنويع بلطف)، وإلا الأولويات ثم التركيز
  const order: Array<{ kind: IncrementKind; metric: string }> = [{ kind: "more", metric: "priorities_done_per_day" }, { kind: "longer", metric: "focus_minutes_per_day" }];
  const startAt = prev?.metric ? Math.max(0, order.findIndex((o) => o.metric === prev.metric)) : 0;
  for (let k = 0; k < order.length; k++) {
    const o = order[(startAt + k) % order.length]!;
    const b = i.baseline[o.metric];
    if (typeof b === "number" && b > 0) {
      const base = prev?.metric === o.metric && prev.outcome === "achieved" && prev.target ? Math.max(b, prev.target) : b;
      // ح.9-8: السقف دائمًا نسبةً إلى خط الأساس، حتى لو بُنيت الزيادة على هدف سابق محقَّق
      const target = Number(Math.min(nextTarget(base, i.stretchPercent), b * (1 + paceConfig.max_over_baseline_percent / 100)).toFixed(2));
      return { kind: o.kind, metric: o.metric, from: b, target };
    }
  }
  if (i.newHabits.length === 0) return { kind: "new_habit", metric: null, from: null, target: null };
  return { kind: "hold", metric: null, from: null, target: null };
}

/** ح.9-8: الزيادة لا تتجاوز 25% عن خط الأساس. */
export function withinCap(baseline: number, target: number): boolean { return target <= baseline * (1 + paceConfig.max_over_baseline_percent / 100) + 1e-9; }

/** ح.5-5: الاقتراح الصباحي = هدف الزيادة النشطة (more) أو خط الأساس، بحد 1–3. */
export function morningPriorityCount(baselinePriorities: number | null, activeTarget: number | null): number {
  const r = paceConfig.morning_priorities_from_pace;
  const v = activeTarget ?? baselinePriorities ?? r.min;
  return Math.max(r.min, Math.min(r.max, Math.round(v)));
}

/** ح.6: «وتيرتك ارتفعت» — ارتفاع خط الأساس في مؤشر واحد N أسابيع متتالية. */
export function paceRising(weeklyBaselines: number[]): boolean {
  const n = paceConfig.achievement.consecutive_weeks;
  if (weeklyBaselines.length < n + 1) return false;
  const tail = weeklyBaselines.slice(-(n + 1));
  for (let k = 1; k < tail.length; k++) if (!(tail[k]! > tail[k - 1]!)) return false;
  return true;
}

/** ح.6: عبارة بلغة الزيادة، والانخفاض بلغة محايدة (لا فشل). */
export function compareSelf(before: number | null, now: number | null): "up" | "down" | "same" | "unknown" {
  if (before === null || now === null) return "unknown";
  const tol = paceConfig.self_compare_tolerance;
  if (now > before * (1 + tol)) return "up";
  if (now < before * (1 - tol)) return "down";
  return "same";
}

/** أيام تحقيق الهدف خلال نافذة الزيادة. */
export function achievedDays(values: Array<number | null>, target: number): number {
  return values.filter((v) => typeof v === "number" && v >= target - 1e-9).length;
}
