/**
 * الراحة المجدِّدة (0.4 هـ) — قواعد نقية: ترتيب الاقتراحات (ملاءمة الوقت ← ذاكرة الراحة ← مدة الفراغ)، القيلولة في نافذتها فقط،
 * المدة لا تتجاوز الفراغ، الممنوعات لا تظهر أبدًا، وضع التهدئة قبل النوم. كل القيم من config/planner.json.rest.
 */
import { planner, type AgeMode } from "@/shared/config";
import { parseHHMM } from "@/modules/notifications/plan";

type ActivityCfg = { durations?: number[]; off_screen?: boolean; only_in_window?: string; alarm_advice?: boolean; daytime_only?: boolean; short_break?: boolean; short_break_first?: boolean; opens?: string; only_in_wind_down?: boolean };
const cfg = planner.rest as unknown as {
  activities: Record<string, ActivityCfg>; nap_latest: string; nap_max_min: number; never_suggest: string[]; show_max: number; duration_never_exceeds_gap: boolean;
  ordering: string[]; screens_explainer_once: boolean; no_tracking_of_other_apps: boolean; timer: Record<string, boolean>; after: { ask_feel: string[]; then: string };
  wind_down: { suggest: string[]; night_plan_before_or_at_start: boolean; suggest_bedtime_habit: boolean; sleep_tracking: boolean }; xp: number; evidence: boolean;
  achievement: { code: string; restorative_sessions_per_week: number }; pomodoro_breaks: { short: string[]; long: string[] };
};
export const restConfig = cfg;
export const REST_KEYS = Object.keys(cfg.activities);

export type RestSuggestion = { key: string; customId?: string; title?: string; durations: number[]; offScreen: boolean; reason: "time" | "memory" | "default"; alarmAdvice: boolean };

export type SuggestInput = {
  ageMode: AgeMode; nowMin: number; enabled: string[]; custom: Array<{ id: string; title: string; default_min: number }>;
  gapMin: number | null; napEnabled: boolean; napWindow: [string, string]; napDefaultMin: number;
  outcomes: Record<string, { uses: number; felt_more_count: number }>;
  bedtime: string | null; windDownMin: number; source: "next" | "free_gap" | "pomodoro" | "priorities_done" | "wind_down" | "manual"; pomodoroBreak?: "short" | "long" | null;
};

export function inWindDown(nowMin: number, bedtime: string | null, windDownMin: number): boolean {
  if (!bedtime) return false;
  const b = parseHHMM(bedtime);
  const start = (b - windDownMin + 1440) % 1440;
  return start < b ? nowMin >= start && nowMin < b : nowMin >= start || nowMin < b;
}

export function napAllowed(i: { nowMin: number; napEnabled: boolean; napWindow: [string, string] }): boolean {
  if (!i.napEnabled) return false;
  const a = parseHHMM(i.napWindow[0]), b = parseHHMM(i.napWindow[1]), latest = parseHHMM(cfg.nap_latest);
  return i.nowMin >= a && i.nowMin < Math.min(b, latest);
}

const isDaytime = (nowMin: number) => nowMin >= parseHHMM("06:00") && nowMin < parseHHMM("18:00");

/** هـ.2: 3–4 أنشطة مرتبة، لا ممنوعات، لا مدة تتجاوز الفراغ. */
export function suggestRest(i: SuggestInput): { shown: RestSuggestion[]; more: RestSuggestion[]; windDown: boolean } {
  const windDown = inWindDown(i.nowMin, i.bedtime, i.windDownMin);
  const all: RestSuggestion[] = [];
  for (const key of i.enabled) {
    if (cfg.never_suggest.includes(key)) continue;
    const a = cfg.activities[key];
    if (!a) continue;
    if (key === "nap" && !napAllowed(i)) continue;
    if (a.only_in_wind_down && !windDown) continue;
    if (a.daytime_only && !isDaytime(i.nowMin)) continue;
    let durations = a.durations ? [...a.durations] : [];
    if (key === "nap") durations = durations.filter((d) => d <= cfg.nap_max_min);
    if (i.gapMin !== null && cfg.duration_never_exceeds_gap) durations = durations.filter((d) => d <= i.gapMin!);
    if (a.durations && durations.length === 0) continue;
    const mem = i.outcomes[key];
    const reason: RestSuggestion["reason"] = (key === "nap" || a.only_in_wind_down) ? "time" : mem && mem.uses >= 3 && mem.felt_more_count / mem.uses >= 0.5 ? "memory" : "default";
    all.push({ key, durations, offScreen: Boolean(a.off_screen), reason, alarmAdvice: Boolean(a.alarm_advice) });
  }
  for (const c of i.custom) {
    if (i.gapMin !== null && cfg.duration_never_exceeds_gap && c.default_min > i.gapMin) continue;
    all.push({ key: "custom", customId: c.id, title: c.title, durations: [c.default_min], offScreen: true, reason: "default", alarmAdvice: false });
  }
  const score = (s: RestSuggestion) => {
    let v = 0;
    if (s.reason === "time") v += 100;
    if (windDown && cfg.wind_down.suggest.includes(s.key)) v += 50;
    if (i.pomodoroBreak && cfg.pomodoro_breaks[i.pomodoroBreak].includes(s.key)) v += 40;
    if (s.reason === "memory") v += 20 + (i.outcomes[s.key]!.felt_more_count / i.outcomes[s.key]!.uses) * 10;
    if (i.gapMin !== null && s.durations.length) v += Math.min(10, s.durations[s.durations.length - 1]! / i.gapMin * 10);
    return v;
  };
  const ordered = all.sort((a, b) => score(b) - score(a));
  return { shown: ordered.slice(0, cfg.show_max), more: ordered.slice(cfg.show_max), windDown };
}

/** إنجاز «راحة تجدّد»: N أنشطة في أسبوع واحد (هـ.7). */
export function restfulWeekReached(sessionsInWeek: number): boolean { return sessionsInWeek >= cfg.achievement.restorative_sessions_per_week; }
export const restXp = cfg.xp;           // = 0 دائمًا (هـ.7)
export const restGivesEvidence = cfg.evidence;  // = false
