/** Pomodoro ووضع التركيز (0.4 ب.6) — قواعد نقية. الاستراحات تقترح أنشطة الراحة المجدِّدة (هـ). */
import { planner } from "@/shared/config";

const f = planner.focus as unknown as { pomodoro_long_break_min: number; long_break_after_sessions: number; focus_mode_hides_other_ui: boolean };
const rest = planner.rest as unknown as { pomodoro_breaks: { short: string[]; long: string[] } };

export type BreakPlan = { kind: "short" | "long"; minutes: number; suggestedActivities: string[] };

/** بعد الجلسة رقم n (1-based): استراحة طويلة كل long_break_after_sessions، وإلا قصيرة. */
export function breakAfter(sessionNumber: number, shortMin: number): BreakPlan {
  const long = sessionNumber > 0 && sessionNumber % f.long_break_after_sessions === 0;
  return long ? { kind: "long", minutes: f.pomodoro_long_break_min, suggestedActivities: rest.pomodoro_breaks.long } : { kind: "short", minutes: shortMin, suggestedActivities: rest.pomodoro_breaks.short };
}

/** دقائق الجلسة الفعلية (تُسجَّل في المدة الفعلية للمهمة). */
export function sessionMinutes(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
}

export const focusHidesOtherUi = f.focus_mode_hides_other_ui;
