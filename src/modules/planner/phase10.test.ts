/** المرحلة 10 — قواعد المخطط النقية: XP بشرط التقدير أو الكتلة، العادات بأيام مرنة، الإحصائيات، Pomodoro، قيم الأدلة الخفيفة. */
import { describe, it, expect } from "vitest";
import { taskCompletionXp, estimateKept, blockKept, dailyLimitFor, amountFor } from "./xp";
import { streak, weeklyAdherence, scheduledOn, habitConsistency, weekStartOf, habitDaysReached } from "./habits";
import { d1Value, d3Value, f1Value, m2Value } from "./evidence-values";
import { breakAfter, sessionMinutes } from "./focus";
import { weeklyCompletionRate, mostPostponed, estimateAccuracy } from "./stats";
import { game, planner } from "@/shared/config";
import type { PlannerTaskRow } from "./types";

describe("XP المخطط (ب.8) — لا نقاط على عدد المنجز", () => {
  it("إنجاز مهمة بلا تقدير ولا كتلة ⇒ صفر XP؛ ضمن ±20% ⇒ 3؛ داخل الكتلة ⇒ 3", () => {
    const at = new Date("2026-11-07T10:00:00Z");
    expect(taskCompletionXp({ taskId: "t", estimateMin: null, actualMin: null, completedAt: at, block: null })).toEqual([]);
    expect(taskCompletionXp({ taskId: "t", estimateMin: 30, actualMin: 35, completedAt: at, block: null })).toEqual([{ reason: "planner_estimate_kept", amount: game.xp.rewards.planner_estimate_kept, source_id: "t" }]);
    expect(taskCompletionXp({ taskId: "t", estimateMin: 30, actualMin: 40, completedAt: at, block: null })).toEqual([]);
    expect(taskCompletionXp({ taskId: "t", estimateMin: null, actualMin: null, completedAt: at, block: { starts_at: "2026-11-07T09:00:00Z", ends_at: "2026-11-07T11:00:00Z" } })).toEqual([{ reason: "planner_block_kept", amount: 3, source_id: "t" }]);
    expect(estimateKept(50, 60)).toBe(true); expect(estimateKept(50, 61)).toBe(false);
    expect(blockKept(at, { starts_at: "2026-11-07T11:00:00Z", ends_at: "2026-11-07T12:00:00Z" })).toBe(false);
  });
  it("الحدود اليومية من config", () => {
    expect(dailyLimitFor("focus_session_done")).toBe(game.xp.planner_rules.focus_sessions_max_per_day);
    expect(dailyLimitFor("habit_checkin")).toBe(3); expect(dailyLimitFor("followup_checkin")).toBe(5); expect(dailyLimitFor("transition_started")).toBe(3);
    expect(dailyLimitFor("muhasaba_done")).toBe(1); expect(amountFor("muhasaba_done")).toBe(5); expect(amountFor("weekly_review_done")).toBe(15);
  });
});

describe("العادات (ب.7): سلسلة بلا عقوبة", () => {
  const daily = { kind: "daily" as const };
  const ci = (dates: string[]) => dates.map((date) => ({ date, done: true, flex_used: false }));
  it("انقطاع يوم في عادة لها يوم مرن لا يكسر السلسلة؛ انقطاعان يكسرانها بهدوء وأفضل سلسلة تبقى", () => {
    const r = streak(daily, ci(["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05"]), 1, "2026-11-01", "2026-11-05", "sat");
    expect(r.current).toBe(4); expect(r.best).toBe(4);
    const broken = streak(daily, ci(["2026-11-01", "2026-11-02", "2026-11-05"]), 1, "2026-11-01", "2026-11-05", "sat");
    expect(broken.current).toBe(1); expect(broken.best).toBe(2);
    expect(streak(daily, ci(["2026-11-01", "2026-11-02", "2026-11-05"]), 0, "2026-11-01", "2026-11-05", "sat").best).toBe(2);
  });
  it("الأيام المرنة تُعاد كل أسبوع، واليوم غير المنتهي لا يكسر", () => {
    // سبت 2026-10-31 بداية الأسبوع؛ تخطّى الأحد 11-01 والأحد 11-08 بيوم مرن لكل أسبوع
    const r = streak(daily, ci(["2026-10-31", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-09"]), 1, "2026-10-31", "2026-11-09", "sat");
    expect(r.current).toBe(8);
    expect(streak(daily, ci(["2026-11-01"]), 0, "2026-11-01", "2026-11-02", "sat").current).toBe(1);
  });
  it("نسبة الالتزام الأسبوعية هي المؤشر الرئيسي؛ أيام محددة وN مرات أسبوعيًا", () => {
    const set = { kind: "weekdays_set" as const, days: [0, 2] };
    expect(scheduledOn(set, "2026-11-08", "sat")).toBe(true); expect(scheduledOn(set, "2026-11-09", "sat")).toBe(false);
    expect(weeklyAdherence(set, ci(["2026-11-08"]), "2026-11-07", "sat")).toBe(0.5);
    expect(weeklyAdherence({ kind: "times_per_week", times: 3 }, ci(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]), "2026-11-07", "sat")).toBe(1);
    expect(weekStartOf("2026-11-09", "sat")).toBe("2026-11-07"); expect(weekStartOf("2026-11-09", "mon")).toBe("2026-11-09");
  });
  it("habit_consistency: نسبة ≥ X لمدة N أسابيع مكتملة؛ 7 أيام عادة", () => {
    const all: string[] = []; for (let d = 24; d <= 30; d++) all.push(`2026-10-${d}`); for (let d = 31; d <= 31; d++) all.push(`2026-10-${d}`); for (let d = 1; d <= 6; d++) all.push(`2026-11-0${d}`);
    expect(habitConsistency(daily, ci(all), "2026-11-10", "sat", 0.8, 2)).toBe(true);
    expect(habitConsistency(daily, ci(all.slice(0, 5)), "2026-11-10", "sat", 0.8, 2)).toBe(false);
    expect(habitDaysReached({ current: 7, best: 7, flexUsedThisWeek: 0 }, game.achievements.habit_7_days.days)).toBe(true);
  });
});

describe("قيم الأدلة الخفيفة (ج.8، د.7، ز.5): لا سلبي أبدًا", () => {
  it("D1 / D3 / F1 / M2", () => {
    expect(d1Value(3, 3)).toBe(0.8); expect(d1Value(3, 2)).toBe(0.4); expect(d1Value(3, 1)).toBe(0); expect(d1Value(0, 0)).toBeNull();
    expect(d3Value(2, 1)).toBe(0.3); expect(d3Value(2, 2)).toBe(0.6); expect(d3Value(2, 0)).toBe(0);
    expect(f1Value(true, 2, 2)).toBe(0.5); expect(f1Value(true, 1, 2)).toBeNull(); expect(f1Value(false, 3, 2)).toBeNull();
    expect(m2Value(true, 0.6)).toBe(0.6); expect(m2Value(false, 0.6)).toBeNull();
    for (const v of [d1Value(5, 0), d3Value(5, 0)]) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("Pomodoro (ب.6) والإحصائيات (ب.9)", () => {
  it("استراحة طويلة بعد 4 جلسات تقترح أنشطة الراحة المناسبة", () => {
    expect(breakAfter(1, 5)).toMatchObject({ kind: "short", minutes: 5 });
    expect(breakAfter(4, 5)).toMatchObject({ kind: "long", minutes: 15 });
    expect(breakAfter(4, 5).suggestedActivities).toEqual((planner.rest as { pomodoro_breaks: { long: string[] } }).pomodoro_breaks.long);
    expect(sessionMinutes(new Date("2026-11-07T10:00:00Z"), new Date("2026-11-07T10:25:30Z"))).toBe(26);
  });
  it("نسبة الإنجاز، الأكثر تأجيلًا، دقة التقدير", () => {
    const row = (o: Partial<PlannerTaskRow>): PlannerTaskRow => ({ id: Math.random().toString(36).slice(2), profile_id: "p", project_id: null, section_id: null, parent_task_id: null, title: "t", notes: null, priority: "none", due_date: "2026-11-08", due_time: null, estimate_min: null, actual_min: null, status: "open", completed_at: null, cancel_reason: null, recurrence_rrule: null, recur_from: "schedule", important: false, urgent: false, kanban_column: null, postpone_count: 0, postpone_prompted: false, created_via: "manual", created_by: null, auto_rescheduled: false, linked_goal_id: null, created_at: "", updated_at: "", ...o });
    const tasks = [row({ status: "done", completed_at: "2026-11-08T10:00:00Z", estimate_min: 30, actual_min: 45 }), row({ status: "open", postpone_count: 4, title: "x" }), row({ status: "cancelled" })];
    expect(weeklyCompletionRate(tasks, "2026-11-07")).toBe(0.5);
    expect(mostPostponed(tasks)[0]).toMatchObject({ title: "x", postpone_count: 4 });
    expect(estimateAccuracy(tasks, (d) => weekStartOf(d, "sat"))).toEqual([{ week: "2026-11-07", mean_rel_error: 0.5, n: 1 }]);
  });
});
