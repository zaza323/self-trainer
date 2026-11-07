/** ح.9: اختبارات قبول الوتيرة الشخصية (حسابات نقية). */
import { describe, it, expect } from "vitest";
import { baselines, incrementOutcome, nextTarget, proposeIncrement, morningPriorityCount, withinCap, paceRising, median, achievedDays, habitUnderConsolidation, habitConsolidated, compareSelf, stretchFor, type DayMetrics } from "./rules";

const days = (n: number, v: Record<string, number>): DayMetrics[] => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, active: true, values: v }));

describe("ح.9", () => {
  it("1: أقل من 7 أيام نشطة ⇒ لا خط أساس ولا اقتراح", () => {
    expect(baselines(days(6, { priorities_done_per_day: 2 }))).toBeNull();
    expect(proposeIncrement({ ageMode: "teen", stretchPercent: 10, baseline: null, previous: null, newHabits: [], hardWeek: false })).toBeNull();
    const b = baselines([...days(7, { priorities_done_per_day: 2 }), { date: "2026-11-30", active: false, values: { priorities_done_per_day: 9 } }]);
    expect(b).toEqual({ sampleDays: 7, values: { priorities_done_per_day: 2 } });
  });
  it("2: تحقيق 6 من 7 ⇒ زيادة ≈ 10% بحد أدنى وحدة (ولا تتجاوز 25%)", () => {
    expect(incrementOutcome(6, 7)).toBe("achieved");
    expect(nextTarget(30, 10)).toBe(33);       // 10% = 3 > وحدة
    expect(nextTarget(8, 10)).toBe(9);          // 10% = 0.8 < وحدة ⇒ +1 (12.5% ≤ 25%)
    expect(nextTarget(2, 10)).toBe(2.5);        // وحدة = 50% > 25% ⇒ السقف يغلب
    const p = proposeIncrement({ ageMode: "teen", stretchPercent: 10, baseline: { priorities_done_per_day: 8, focus_minutes_per_day: 30 }, previous: { kind: "more", metric: "priorities_done_per_day", target: 8, outcome: "achieved" }, newHabits: [], hardWeek: false });
    expect(p).toMatchObject({ kind: "more", metric: "priorities_done_per_day", from: 8, target: 9 });
  });
  it("3: تحقيق 3 من 7 ⇒ رجوع إلى خط الأساس (hold عند الخط) بلا لوم", () => {
    expect(incrementOutcome(3, 7)).toBe("stepped_back");
    expect(incrementOutcome(4, 7)).toBe("held");
    const p = proposeIncrement({ ageMode: "adult", stretchPercent: 10, baseline: { priorities_done_per_day: 2 }, previous: { kind: "more", metric: "priorities_done_per_day", target: 2.5, outcome: "stepped_back" }, newHabits: [], hardWeek: false });
    expect(p).toMatchObject({ kind: "hold", target: 2 });
  });
  it("4: عادة جديدة التزامها 50% ⇒ الاقتراح الوحيد consolidate", () => {
    const nh = { habitId: "h", title: "قراءة", createdDaysAgo: 10, weeklyAdherence: [0.5] };
    expect(habitUnderConsolidation(nh)).toBe(true);
    expect(proposeIncrement({ ageMode: "teen", stretchPercent: 10, baseline: { priorities_done_per_day: 3, focus_minutes_per_day: 40 }, previous: null, newHabits: [nh], hardWeek: false })).toMatchObject({ kind: "consolidate", habitId: "h" });
    expect(habitConsolidated({ ...nh, weeklyAdherence: [0.8, 0.75] })).toBe(true);
  });
  it("5: خط أساس أولويتين ⇒ الاقتراح الصباحي لا يتجاوز 3 ولا يقل عن 1", () => {
    expect(morningPriorityCount(2, null)).toBe(2);
    expect(morningPriorityCount(2, 2.5)).toBeLessThanOrEqual(3);
    expect(morningPriorityCount(6, null)).toBe(3);
    expect(morningPriorityCount(null, null)).toBe(1);
  });
  it("8: لا زيادة تتجاوز 25% عن خط الأساس", () => {
    for (const b of [1, 2, 3, 5, 8, 25, 60]) for (const s of [5, 10, 20]) expect(withinCap(b, nextTarget(b, s))).toBe(true);
    expect(stretchFor("teen", 20)).toBe(10); expect(stretchFor("adult", 20)).toBe(20);
  });
  it("وسيط، أيام التحقيق، «وتيرتك ارتفعت»، المقارنة بالنفس فقط", () => {
    expect(median([3, 1, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(achievedDays([3, 2, null, 3], 3)).toBe(2);
    expect(paceRising([1, 1.2, 1.4, 1.6])).toBe(true); expect(paceRising([1, 1.2, 1.2, 1.6])).toBe(false);
    expect(compareSelf(1, 2)).toBe("up"); expect(compareSelf(2, 1)).toBe("down"); expect(compareSelf(null, 1)).toBe("unknown");
  });
  it("hold بعد أسبوع صعب؛ new_habit حين لا مؤشرات ولا عادات", () => {
    expect(proposeIncrement({ ageMode: "teen", stretchPercent: 10, baseline: { priorities_done_per_day: 2 }, previous: null, newHabits: [], hardWeek: true })!.kind).toBe("hold");
    expect(proposeIncrement({ ageMode: "teen", stretchPercent: 10, baseline: { follow_through: 0.8 }, previous: null, newHabits: [], hardWeek: false })!.kind).toBe("new_habit");
  });
});
