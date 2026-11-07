/**
 * شاشة البداية ولحظات اليوم (0.4 ج) — اختيار الافتتاحية حتمي من الخادم بلا ذكاء اصطناعي (ج.7)، بترتيب ج.4.
 * النوافذ من الإعداد moment_windows مع رموز: quiet_hours_start، wind_down_start_or_21:00. كل القيم من config/planner.json.daily_moments.
 */
import { planner, type AgeMode } from "@/shared/config";
import { parseHHMM } from "@/modules/notifications/plan";
import openersContent from "@content/daily_openers.ar.json";

export const MOMENT_KEYS = ["morning_plan", "midday_check", "evening_review", "night_plan", "muhasaba"] as const;
export type MomentKey = (typeof MOMENT_KEYS)[number];
export type CheckinStatus = "shown" | "dismissed" | "answered";

const dm = planner.daily_moments as unknown as {
  moments: Record<string, Record<string, unknown>>;
  opener_priority: string[]; light_opener: { shortcuts_max: number; exempt_from_free_text_budget: boolean; requires_answer: boolean };
  deadline_cards_max: number; once_per_day: boolean; dismiss_hides_until_window_end: boolean; max_free_text_moments_per_day: number;
  disabled_in_break_mode: boolean; max_sheets_per_open: number; muhasaba_replaces_by_default: string[];
  fade: { suggest_reduce_at_avg_support: number; via: string; auto_disable: boolean };
  notifications: { open_app_counts_toward_cap: boolean; push_counts_toward_cap: boolean; morning_evening_push_is_summary: boolean };
  opener_variables: string[]; ai_on_open: boolean;
};
export const momentsConfig = dm;

export type WindowTokens = { quietStart: string | null; windDownStart: string | null };

/** يحوّل نافذة اللحظة إلى دقائق محلية [بداية، نهاية] (النهاية قد تلتف بعد منتصف الليل). */
export function resolveWindow(w: [string, string], t: WindowTokens): [number, number] | null {
  const tok = (s: string): number | null => {
    if (s === "quiet_hours_start") return t.quietStart ? parseHHMM(t.quietStart) : 24 * 60;
    if (s === "wind_down_start_or_21:00") return t.windDownStart ? parseHHMM(t.windDownStart) : parseHHMM("21:00");
    return /^\d{2}:\d{2}$/.test(s) ? parseHHMM(s) : null;
  };
  const a = tok(w[0]), b = tok(w[1]);
  if (a === null || b === null) return null;
  return [a, b];
}

export function inWindow(nowMin: number, w: [number, number]): boolean {
  const [a, b] = w;
  if (a === b) return false;
  return a < b ? nowMin >= a && nowMin < b : nowMin >= a || nowMin < b;
}

export type OpenerInput = {
  ageMode: AgeMode;
  nowMin: number;                         // الدقيقة المحلية
  breakMode: boolean;
  safetyPending: boolean;                 // تنبيه أمان أو طلب مربٍ معلّق
  comeback: boolean;                      // عودة بعد انقطاع ≥ N أيام (5.5)
  followupsPending: number;               // عناصر انتهى وقتها (د)
  deadlineSoon: { title: string; dueLabel: string } | null;  // مهمة عالية/مهمة خلال deadline_urgent_hours
  enabledMoments: string[];
  windows: Record<string, [string, string]>;
  tokens: WindowTokens;
  checkinsToday: Partial<Record<MomentKey, CheckinStatus>>;
  nightPlanExists: boolean;               // خطة ليلية لليوم ⇒ الصباح تأكيد
  quietNow: boolean;                      // داخل ساعات الهدوء الآن
  hasAnyTasks: boolean;
};

export type OpenerDecision =
  | { kind: "safety" } | { kind: "comeback" } | { kind: "followup"; count: number } | { kind: "deadline"; title: string; dueLabel: string }
  | { kind: "moment"; moment: MomentKey; confirm: boolean } | { kind: "light" } | { kind: "no_tasks" };

/** اللحظات التي تحل محلها المحاسبة عند تفعيلها (config). */
export function effectiveMoments(enabled: string[]): MomentKey[] {
  const set = new Set(enabled.filter((m): m is MomentKey => (MOMENT_KEYS as readonly string[]).includes(m)));
  if (set.has("muhasaba")) for (const r of dm.muhasaba_replaces_by_default) set.delete(r as MomentKey);
  return MOMENT_KEYS.filter((m) => set.has(m));
}

/** اللحظة المستحقة الآن: مفعّلة، في نافذتها، لم تُعرض/تُرفض/تُجَب اليوم؛ night_plan لا يظهر للطفل بعد بداية الهدوء. */
export function dueMoment(i: OpenerInput): MomentKey | null {
  if (i.breakMode && dm.disabled_in_break_mode) return null;
  for (const m of effectiveMoments(i.enabledMoments)) {
    const raw = i.windows[m];
    if (!raw) continue;
    const w = resolveWindow(raw, i.tokens);
    if (!w || !inWindow(i.nowMin, w)) continue;
    if (i.checkinsToday[m]) continue;                        // مرة واحدة يوميًا؛ «مش هلق» يخفيها حتى نهاية النافذة
    if ((m === "night_plan" || m === "muhasaba") && i.ageMode === "child" && i.quietNow) continue;
    return m;
  }
  return null;
}

/** ترتيب ج.4 (مع د.8): أمان ← عودة ← متابعة ← موعد قريب ← لحظة الوقت ← خفيفة. */
export function chooseOpener(i: OpenerInput): OpenerDecision {
  for (const p of dm.opener_priority) {
    if (p === "safety_or_guardian_request" && i.safetyPending) return { kind: "safety" };
    if (p === "comeback" && i.comeback) return { kind: "comeback" };
    if (p === "followup" && i.followupsPending > 0) return { kind: "followup", count: i.followupsPending };
    if (p === "deadline_urgent" && i.deadlineSoon) return { kind: "deadline", ...i.deadlineSoon };
    if (p === "time_moment") { const m = dueMoment(i); if (m) return { kind: "moment", moment: m, confirm: m === "morning_plan" && i.nightPlanExists }; }
    if (p === "light_opener") break;
  }
  return i.hasAnyTasks ? { kind: "light" } : { kind: "no_tasks" };
}

export type OpenerVars = { name?: string; today_count?: number; overdue_count?: number; top_deadline?: string; top_priorities?: string; schedule?: string; done_count?: number; planned_count?: number };

/** نص الافتتاحية من المحتوى (3–5 صيغ تتناوب بحسب اليوم)، بلا ذكاء اصطناعي. */
export function renderOpener(key: string, ageMode: AgeMode, vars: OpenerVars, rotation = 0): string {
  const table = (openersContent as unknown as Record<string, Record<AgeMode, string[]> | undefined>)[key];
  const list = table?.[ageMode] ?? table?.adult ?? [];
  if (list.length === 0) return "";
  const tpl = list[Math.abs(rotation) % list.length]!;
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => { const v = (vars as Record<string, unknown>)[k]; return v === undefined || v === null || v === "" ? "—" : String(v); });
}

/** رقم تناوب حتمي من التاريخ. */
export function rotationFor(date: string): number { return Number(date.replace(/-/g, "")) % 7; }

/** نوع لحظة الرد (أ.2) لكل لحظة يوم. */
export function replyMomentFor(m: MomentKey, confirm: boolean): string {
  if (confirm) return "confirm";
  const cfg = dm.moments[m] as { reply_moment?: string; reply_moments?: string[] };
  return cfg.reply_moment ?? cfg.reply_moments?.[0] ?? "free_chat";
}

export const maxSheetsPerOpen = dm.max_sheets_per_open;
export const lightShortcutsMax = dm.light_opener.shortcuts_max;
export const deadlineCardsMax = dm.deadline_cards_max;
export const fadeSuggestAt = dm.fade.suggest_reduce_at_avg_support;
export const openAppCountsTowardCap = dm.notifications.open_app_counts_toward_cap;
export const aiOnOpen = dm.ai_on_open;
