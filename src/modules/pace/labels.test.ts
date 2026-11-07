/** ح.9-6: لا مقارنة بالآخرين في نصوص الوتيرة؛ الانخفاض بلغة محايدة مع سؤال واحد؛ ح.9-8 السقف يغلب حتى بعد زيادة محققة. */
import { describe, it, expect } from "vitest";
import { compareLine, incrementText, paceContent } from "./labels";
import { proposeIncrement, withinCap } from "./rules";

const OTHERS = /(غيرك|الآخرين|الاخرين|أصحابك|اصحابك|زملائك|أقرانك|اقرانك|باقي الناس|ترتيبك|المرتبة)/;
const BLAME = /(فشل|كسول|ضيّعت|ضيعت|قصّرت)/;
describe("وتيرتي — نصوص", () => {
  it("لا كلمة مقارنة بالآخرين ولا لوم في أي نص", () => {
    const all = JSON.stringify(paceContent, (k, v) => (k.startsWith("_") ? undefined : v));
    expect(all).not.toMatch(OTHERS); expect(all).not.toMatch(BLAME);
  });
  it("الارتفاع بلغة الزيادة، الانخفاض محايد بسؤال واحد", () => {
    expect(compareLine("priorities_done_per_day", 1, 2)).toBe("صرت 2 بعد ما كانت 1.");
    const down = compareLine("focus_minutes_per_day", 30, 20)!;
    expect(down.match(/؟/g)).toHaveLength(1); expect(down).not.toMatch(BLAME);
    expect(compareLine("follow_through", 0.5, 0.5)).toContain("50%");
  });
  it("الطفل يرى الزيادة بلغة بسيطة", () => {
    const inc = { kind: "longer", metric: "focus_minutes_per_day", from_value: 20, target_value: 22, description: null };
    expect(incrementText(inc, "child")).toBe("هالأسبوع نجرب 22 بدل 20");
    expect(incrementText(inc, "adult")).toContain("22");
  });
});
describe("السقف بعد زيادة محققة", () => {
  it("هدف سابق محقق أعلى من الأساس لا يدفع الاقتراح فوق السقف (50% من خط الأساس)", () => {
    const p = proposeIncrement({ ageMode: "adult", stretchPercent: 20, baseline: { focus_minutes_per_day: 20 }, previous: { kind: "longer", metric: "focus_minutes_per_day", target: 24, outcome: "achieved" }, newHabits: [], hardWeek: false })!;
    expect(withinCap(20, p.target!)).toBe(true); expect(p.target).toBe(28.8);
    const far = proposeIncrement({ ageMode: "adult", stretchPercent: 20, baseline: { focus_minutes_per_day: 20 }, previous: { kind: "longer", metric: "focus_minutes_per_day", target: 29, outcome: "achieved" }, newHabits: [], hardWeek: false })!;
    expect(far.target).toBe(30);
  });
});
