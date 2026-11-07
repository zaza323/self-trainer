/**
 * التفاعل والإشعارات المتكيّفة (0.4 و) — قواعد نقية. الحالة لا تظهر للمستخدم كتصنيف؛ هي لضبط سلوك التطبيق فقط.
 * كل القيم من config/planner.json.engagement. السقف الصلب حاجز لا يُضبط.
 */
import { planner, type AgeMode } from "@/shared/config";

export type EngagementState = "momentum" | "steady" | "low" | "away";
const cfg = planner.engagement as unknown as {
  states: EngagementState[]; overlay: string;
  metrics: { follow_through: { ewma_alpha: number; window_days: number }; active_days_window: number; notif_response: { opened_within_hours: number; last_n: number } };
  rules: { momentum: { min_follow_through: number; min_active_days: number; min_wins_24h: number }; low: { max_follow_through: number; max_active_days: number; ignored_in_row: number }; away: { no_open_days: number }; busy: string[] };
  productive_absence: { min_absence_hours: number; min_done_ratio: number; or_min_retro_completions: number };
  busy_windows: { min_occurrences: number; lookback_weeks: number; granularity: string; user_can_delete: boolean };
  budget: { momentum: Record<AgeMode, number>; steady: Record<AgeMode, number>; low: Record<AgeMode, number>; away: { every_days: number; after_14_days: string; after_30_days: string }; busy: number; break_mode: number };
  ceiling: Record<AgeMode, number>; spacing_minutes: { default: number; momentum: number };
  step_down: { ignored_in_momentum: number; to: EngagementState; ignored_to_low: number }; step_up_max_per_day: number;
  low_forbid_backlog_counts: boolean; away_bundle_user_reminders_daily: boolean; busy_bundle_on_end: boolean; safety_alerts_exempt: boolean; state_visible_as_label: boolean;
  retro_completions: { xp: number; evidence: boolean; counts_in_stats_and_pace: boolean };
};
export const engagementConfig = cfg;
const ORDER: EngagementState[] = ["away", "low", "steady", "momentum"];

/** الالتزام: متوسط متحرك أُسّي على نِسب الأيام (المنجز ÷ (المنجز + ما صار))، الأقدم أولًا. */
export function followThrough(dailyRatios: Array<number | null>): number | null {
  const a = cfg.metrics.follow_through.ewma_alpha;
  let v: number | null = null;
  for (const r of dailyRatios.slice(-cfg.metrics.follow_through.window_days)) {
    if (r === null) continue;
    v = v === null ? r : a * r + (1 - a) * v;
  }
  return v === null ? null : Number(v.toFixed(3));
}

export type StateInput = { followThrough: number | null; activeDays7: number; winsLast24h: number; ignoredInRow: number; daysSinceOpen: number; breakMode: boolean };

/** و.2: الحالة المحسوبة من المؤشرات (بلا تدرّج الصعود؛ انظر applyStepUp). */
export function computeState(i: StateInput): EngagementState {
  if (!i.breakMode && i.daysSinceOpen >= cfg.rules.away.no_open_days) return "away";
  const ft = i.followThrough;
  const low = cfg.rules.low, mo = cfg.rules.momentum;
  if ((ft !== null && ft < low.max_follow_through) || i.activeDays7 <= low.max_active_days || i.ignoredInRow >= low.ignored_in_row) return "low";
  if (ft !== null && ft >= mo.min_follow_through && i.activeDays7 >= mo.min_active_days && i.winsLast24h >= mo.min_wins_24h) return "momentum";
  return "steady";
}

/** الصعود تدريجي: خطوة واحدة يوميًا كحد أقصى؛ الهبوط فوري. */
export function applyStepUp(previous: EngagementState | null, computed: EngagementState): EngagementState {
  if (!previous) return computed === "momentum" ? "steady" : computed;
  const p = ORDER.indexOf(previous), c = ORDER.indexOf(computed);
  if (c <= p) return computed;
  return ORDER[Math.min(c, p + cfg.step_up_max_per_day)]!;
}

/** الهبوط التلقائي بالتجاهل (و.4): 2 متتاليان في momentum ⇒ steady؛ 3 ⇒ low. */
export function applyIgnoreStepDown(state: EngagementState, ignoredInRow: number): EngagementState {
  if (ignoredInRow >= cfg.step_down.ignored_to_low) return "low";
  if (state === "momentum" && ignoredInRow >= cfg.step_down.ignored_in_momentum) return cfg.step_down.to;
  return state;
}

export type BudgetInput = { state: EngagementState; ageMode: AgeMode; breakMode: boolean; busy: boolean; userMax: number | "auto" };

/** و.4: ميزانية اليوم لما يبادر به التطبيق؛ المستخدم يخفض ولا يرفع؛ السقف الصلب لا يُتجاوز. away ⇒ 0 يوميًا (إيقاع خاص). */
export function dailyBudget(i: BudgetInput): number {
  const ceiling = cfg.ceiling[i.ageMode];
  if (i.breakMode) return cfg.budget.break_mode;
  if (i.busy) return cfg.budget.busy;
  if (i.state === "away") return 0;
  let b = cfg.budget[i.state][i.ageMode];
  if (i.userMax !== "auto") b = Math.min(b, i.userMax);
  return Math.min(b, ceiling);
}

export function spacingMinutes(state: EngagementState): number { return state === "momentum" ? cfg.spacing_minutes.momentum : cfg.spacing_minutes.default; }

/** إيقاع الغياب: كل 3 أيام، بعد 14 يومًا أسبوعيًا، بعد 30 يومًا يتوقف. */
export function awayNotificationDue(daysAway: number, daysSinceLastAwayNotif: number | null): boolean {
  if (daysAway < cfg.rules.away.no_open_days) return false;
  if (daysAway > 30 && cfg.budget.away.after_30_days === "stop") return false;
  const period = daysAway > 14 && cfg.budget.away.after_14_days === "weekly" ? 7 : cfg.budget.away.every_days;
  return daysSinceLastAwayNotif === null || daysSinceLastAwayNotif >= period;
}

export type BusyInput = { focusActive: boolean; blockActive: boolean; scheduledNow: boolean; inLearnedBusyWindow: boolean; dndActive: boolean };
export function isBusy(i: BusyInput): boolean {
  const map: Record<string, boolean> = { focus_session: i.focusActive, time_block: i.blockActive, scheduled_item_now: i.scheduledNow, learned_busy_window: i.inLearnedBusyWindow, dnd: i.dndActive };
  return cfg.rules.busy.some((k) => map[k]);
}

/** و.3: نوافذ الانشغال المتعلَّمة — نفس (يوم الأسبوع + ساعة) ≥ N مرات خلال M أسابيع. */
export function learnBusyWindows(events: Array<{ weekday: number; hour: number }>): Array<{ weekday: number; start_hour: number; end_hour: number; evidence_count: number }> {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(`${e.weekday}:${e.hour}`, (counts.get(`${e.weekday}:${e.hour}`) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= cfg.busy_windows.min_occurrences).map(([k, n]) => { const [w, h] = k.split(":").map(Number); return { weekday: w!, start_hour: h!, end_hour: h! + 1, evidence_count: n }; });
}

/** و.3: غياب منتج أم لا؟ null إن لم يبلغ الغياب الحد. */
export function classifyAbsence(i: { absenceHours: number; scheduledCount: number; doneCount: number; retroCount: number }): "productive" | "unproductive" | null {
  const p = cfg.productive_absence;
  if (i.absenceHours < p.min_absence_hours) return null;
  if (i.retroCount >= p.or_min_retro_completions) return "productive";
  if (i.scheduledCount > 0 && i.doneCount / i.scheduledCount >= p.min_done_ratio) return "productive";
  return "unproductive";
}

/** و.4 low: ممنوع ذكر عدد المتأخرات أو ما فات. */
export function forbidsBacklogCounts(state: EngagementState): boolean { return state === "low" && cfg.low_forbid_backlog_counts; }
export const notifResponseWindowHours = cfg.metrics.notif_response.opened_within_hours;
export const notifResponseLastN = cfg.metrics.notif_response.last_n;
export const retroXp = cfg.retro_completions.xp;
