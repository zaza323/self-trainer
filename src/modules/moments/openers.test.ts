/** ج.10: اختيار الافتتاحية حتمي بترتيب ج.4، مرة واحدة في النافذة، «مش هلق»، التأكيد بعد خطة ليلية، child وساعات الهدوء، وضع الاستراحة. */
import { describe, it, expect } from "vitest";
import { chooseOpener, dueMoment, renderOpener, resolveWindow, inWindow, effectiveMoments, replyMomentFor, maxSheetsPerOpen, aiOnOpen, openAppCountsTowardCap, type OpenerInput } from "./openers";
import { customization } from "@/shared/config";

const windows = customization.catalog.moment_windows!.default.teen as unknown as Record<string, [string, string]>;
const base: OpenerInput = { ageMode: "teen", nowMin: 8 * 60, breakMode: false, safetyPending: false, comeback: false, followupsPending: 0, deadlineSoon: null, enabledMoments: ["morning_plan", "muhasaba"], windows, tokens: { quietStart: "22:00", windDownStart: null }, checkinsToday: {}, nightPlanExists: false, quietNow: false, hasAnyTasks: true };

describe("ج.10", () => {
  it("1: 08:00 بلا لحظة اليوم ⇒ افتتاحية morning_plan بأرقام من المخطط", () => {
    expect(chooseOpener(base)).toEqual({ kind: "moment", moment: "morning_plan", confirm: false });
    const text = renderOpener("morning_plan", "teen", { today_count: 4, overdue_count: 1 }, 0);
    expect(text).toContain("4"); expect(text).toContain("1");
  });
  it("2: «مش هلق» في 08:00 ثم 10:00 ⇒ خفيفة لا morning_plan", () => {
    expect(chooseOpener({ ...base, nowMin: 10 * 60, checkinsToday: { morning_plan: "dismissed" } })).toEqual({ kind: "light" });
    expect(chooseOpener({ ...base, checkinsToday: { morning_plan: "answered" } })).toEqual({ kind: "light" });
  });
  it("3: موعد قريب يغلب لحظة الوقت؛ 4: العودة تغلب كل شيء عدا الأمان؛ المتابعة قبل الموعد", () => {
    expect(chooseOpener({ ...base, deadlineSoon: { title: "تقرير", dueLabel: "3" } })).toMatchObject({ kind: "deadline", title: "تقرير" });
    expect(chooseOpener({ ...base, comeback: true, deadlineSoon: { title: "x", dueLabel: "1" }, followupsPending: 2 })).toEqual({ kind: "comeback" });
    expect(chooseOpener({ ...base, comeback: true, safetyPending: true })).toEqual({ kind: "safety" });
    expect(chooseOpener({ ...base, followupsPending: 2, deadlineSoon: { title: "x", dueLabel: "1" } })).toEqual({ kind: "followup", count: 2 });
  });
  it("5: خطة ليلية ⇒ لحظة الصباح تأكيد (confirm)", () => {
    expect(chooseOpener({ ...base, nightPlanExists: true })).toEqual({ kind: "moment", moment: "morning_plan", confirm: true });
    expect(replyMomentFor("morning_plan", true)).toBe("confirm"); expect(replyMomentFor("morning_plan", false)).toBe("priority_pick");
  });
  it("6: child لا night_plan ولا muhasaba بعد بداية ساعات الهدوء؛ النافذة تنتهي عند quiet_hours_start", () => {
    const child: OpenerInput = { ...base, ageMode: "child", enabledMoments: ["night_plan"], nowMin: 22 * 60 + 30, quietNow: true, tokens: { quietStart: "22:00", windDownStart: null } };
    expect(dueMoment(child)).toBeNull();
    expect(dueMoment({ ...child, nowMin: 21 * 60 + 30, quietNow: false })).toBe("night_plan");
    expect(resolveWindow(["21:00", "quiet_hours_start"], { quietStart: "22:00", windDownStart: null })).toEqual([21 * 60, 22 * 60]);
    expect(resolveWindow(["wind_down_start_or_21:00", "quiet_hours_start"], { quietStart: "23:00", windDownStart: "22:30" })).toEqual([22 * 60 + 30, 23 * 60]);
    expect(inWindow(23 * 60, [21 * 60, 2 * 60])).toBe(true);
  });
  it("7/10: فتح التطبيق لا يُحسب من الحد ولا يستدعي ذكاءً اصطناعيًا؛ ورقتان كحد أقصى", () => {
    expect(openAppCountsTowardCap).toBe(false); expect(aiOnOpen).toBe(false); expect(maxSheetsPerOpen).toBe(2);
  });
  it("11: في وضع الاستراحة لا تظهر أي لحظة؛ المحاسبة تحل محل المساء والليل", () => {
    expect(chooseOpener({ ...base, breakMode: true })).toEqual({ kind: "light" });
    expect(effectiveMoments(["morning_plan", "evening_review", "night_plan", "muhasaba"])).toEqual(["morning_plan", "muhasaba"]);
    expect(effectiveMoments(["evening_review", "night_plan"])).toEqual(["evening_review", "night_plan"]);
    expect(chooseOpener({ ...base, hasAnyTasks: false, enabledMoments: [] })).toEqual({ kind: "no_tasks" });
  });
});
