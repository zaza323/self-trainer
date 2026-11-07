/**
 * الوتيرة الشخصية والزيادة (0.4 ح) — قواعد نقية. الأرقام حتمية؛ الذكاء الاصطناعي يصيغ فقط.
 * كل القيم من config/planner.json.pace والإعدادات الفعّالة (pace_stretch_percent، max_active_increments).
 */
import { planner, type AgeMode } from "@/shared/config";

type PaceCfg = {
  baseline: { window_active_days: number; statistic: string; min_active_days: number; recompute: string };
  metrics: string[]; increment_kinds: string[];
  result_thresholds: { advance_at: number; hold_from: number };
  stretch_default_percent: number; min_step_units: number;
  cap: { discovery: { min_days: number; min_active_days: number }; soft_over_baseline_percent: number; overreach_pattern: { times: number; achieved_ratio_below: number }; modes: CapMode[]; child_default_mode: CapMode };
  consolidate: { new_habit_adherence_below: number; weeks: number; blocks_other_increments: boolean };
  morning_priorities_from_pace: { min: number; max: number };
  self_compare_tolerance: number; hard_week_low_days: number; lookback_days: number; self_compare_days_ago: number; evaluation_window_days: number; new_habit_window_days: number;
  achievement: { code: string; consecutive_weeks: number };
};
export type CapMode = "hard" | "soft";
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

/** ح.4: نتيجة الزيادة السابقة (نسبة الأيام التي حقق فيها الهدف). للهدف فوق السقف أو في فترة الاكتشاف: انظر outcomeFor. */
export function incrementOutcome(achievedDays: number, windowDays: number): "achieved" | "held" | "stepped_back" {
  const r = windowDays > 0 ? achievedDays / windowDays : 0;
  if (r >= paceConfig.result_thresholds.advance_at) return "achieved";
  if (r >= paceConfig.result_thresholds.hold_from) return "held";
  return "stepped_back";
}

// ---------------------------------------------------------------- سقف الزيادة على مرحلتين
/**
 * فترة الاكتشاف: حتى يمر min_days من البداية ويتجمع min_active_days يوم نشاط (أيهما أبعد). خلالها لا سقف،
 * ويُسجَّل فقط الفرق بين الهدف المختار والمحقق.
 */
export function inDiscovery(i: { daysSinceStart: number; activeDays: number }): boolean {
  const d = paceConfig.cap.discovery;
  return i.daysSinceStart < d.min_days || i.activeDays < d.min_active_days;
}

/** السقف بعد الاكتشاف: خط الأساس + soft_over_baseline_percent، ولا يمنع أبدًا زيادة min_step_units على الأقل. */
export function capFor(baseline: number): number {
  const pct = baseline * (1 + paceConfig.cap.soft_over_baseline_percent / 100);
  return Number(Math.max(pct, baseline + paceConfig.min_step_units).toFixed(2));
}

/** child: المربي يختار (الافتراضي من config)؛ غير الطفل: ناعم دائمًا. */
export function capModeFor(ageMode: AgeMode, setting: CapMode | null | undefined): CapMode {
  if (ageMode !== "child") return "soft";
  return setting && paceConfig.cap.modes.includes(setting) ? setting : paceConfig.cap.child_default_mode;
}

export type TargetCheck =
  | { allowed: true; overCap: false; discovery: boolean; cap: number | null }
  | { allowed: true; overCap: true; discovery: false; cap: number }      // ناعم ومؤكَّد
  | { allowed: false; reason: "needs_confirm" | "over_hard_cap"; cap: number };

/** هل الهدف المختار مقبول؟ اكتشاف ⇒ دائمًا؛ تحت السقف ⇒ نعم؛ فوقه: ناعم بتأكيد، ثابت مرفوض. */
export function checkTarget(i: { baseline: number | null; target: number; discovery: boolean; mode: CapMode; confirmed: boolean }): TargetCheck {
  if (i.discovery || i.baseline === null) return { allowed: true, overCap: false, discovery: i.discovery, cap: null };
  const cap = capFor(i.baseline);
  if (i.target <= cap + 1e-9) return { allowed: true, overCap: false, discovery: false, cap };
  if (i.mode === "hard") return { allowed: false, reason: "over_hard_cap", cap };
  return i.confirmed ? { allowed: true, overCap: true, discovery: false, cap } : { allowed: false, reason: "needs_confirm", cap };
}

/** نمط المبالغة: هدف فوق السقف وتحقيق أقل من achieved_ratio_below، times مرات (يُذكر في التنبيه بلغة محايدة). */
export function overreachCount(history: Array<{ over_cap: boolean; achieved_ratio: number | null }>): number {
  const p = paceConfig.cap.overreach_pattern;
  return history.filter((h) => h.over_cap && h.achieved_ratio !== null && h.achieved_ratio < p.achieved_ratio_below).length;
}
export function overreachPattern(history: Array<{ over_cap: boolean; achieved_ratio: number | null }>): boolean {
  return overreachCount(history) >= paceConfig.cap.overreach_pattern.times;
}

/**
 * نتيجة الزيادة: الهدف فوق السقف أو في الاكتشاف إن لم يتحقق ⇒ noted (معلومة فقط): لا يُحسب «زيادة لم تتحقق»
 * ولا يرجع المستخدم لخط الأساس.
 */
export function outcomeFor(i: { achievedDays: number; windowDays: number; overCap: boolean; discovery: boolean }): "achieved" | "held" | "stepped_back" | "noted" {
  const o = incrementOutcome(i.achievedDays, i.windowDays);
  if (o !== "achieved" && (i.overCap || i.discovery)) return "noted";
  return o;
}

/** ح.4: حجم الاقتراح — +stretch% (10% افتراضيًا) بحد أدنى وحدة، ضمن السقف (والسقف لا يمنع الوحدة). */
export function nextTarget(baseline: number, stretchPercent: number): number {
  const stretch = baseline * (stretchPercent / 100);
  const raw = baseline + Math.max(stretch, paceConfig.min_step_units);
  return Number(Math.max(Math.min(raw, capFor(baseline)), baseline).toFixed(2));
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
      // السقف دائمًا نسبةً إلى خط الأساس، حتى لو بُنيت الزيادة على هدف سابق محقَّق
      const target = Number(Math.min(nextTarget(base, i.stretchPercent), capFor(b)).toFixed(2));
      return { kind: o.kind, metric: o.metric, from: b, target };
    }
  }
  if (i.newHabits.length === 0) return { kind: "new_habit", metric: null, from: null, target: null };
  return { kind: "hold", metric: null, from: null, target: null };
}

/** الهدف ضمن السقف (بعد الاكتشاف). */
export function withinCap(baseline: number, target: number): boolean { return target <= capFor(baseline) + 1e-9; }

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
