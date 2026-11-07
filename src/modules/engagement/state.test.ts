/** و.9: الحالات، الميزانيات والسقف، التباعد، الهبوط بالتجاهل، الصعود التدريجي، الغياب المنتج، نوافذ الانشغال، إيقاع الغياب. */
import { describe, it, expect } from "vitest";
import { computeState, followThrough, dailyBudget, spacingMinutes, applyIgnoreStepDown, applyStepUp, classifyAbsence, learnBusyWindows, awayNotificationDue, isBusy, forbidsBacklogCounts } from "./state";

describe("و.9", () => {
  it("1/8: momentum adult ⇒ 6 بتباعد 60؛ child لا يتجاوز 3 في أي حالة؛ steady 2؛ low 1؛ busy 0؛ الاستراحة 0؛ المستخدم يخفض ولا يرفع", () => {
    expect(dailyBudget({ state: "momentum", ageMode: "adult", breakMode: false, busy: false, userMax: "auto" })).toBe(6);
    expect(spacingMinutes("momentum")).toBe(60); expect(spacingMinutes("steady")).toBe(90);
    for (const s of ["momentum", "steady", "low"] as const) expect(dailyBudget({ state: s, ageMode: "child", breakMode: false, busy: false, userMax: "auto" })).toBeLessThanOrEqual(3);
    expect(dailyBudget({ state: "steady", ageMode: "teen", breakMode: false, busy: false, userMax: "auto" })).toBe(2);
    expect(dailyBudget({ state: "low", ageMode: "adult", breakMode: false, busy: false, userMax: "auto" })).toBe(1);
    expect(dailyBudget({ state: "momentum", ageMode: "adult", breakMode: false, busy: true, userMax: "auto" })).toBe(0);
    expect(dailyBudget({ state: "momentum", ageMode: "adult", breakMode: true, busy: false, userMax: "auto" })).toBe(0);
    expect(dailyBudget({ state: "momentum", ageMode: "adult", breakMode: false, busy: false, userMax: 2 })).toBe(2);
    expect(dailyBudget({ state: "steady", ageMode: "adult", breakMode: false, busy: false, userMax: 10 })).toBe(2);
    expect(dailyBudget({ state: "away", ageMode: "adult", breakMode: false, busy: false, userMax: "auto" })).toBe(0);
  });
  it("2: تجاهل إشعارين في momentum ⇒ steady؛ 3 ⇒ low؛ الصعود خطوة واحدة يوميًا", () => {
    expect(applyIgnoreStepDown("momentum", 2)).toBe("steady"); expect(applyIgnoreStepDown("momentum", 1)).toBe("momentum"); expect(applyIgnoreStepDown("steady", 3)).toBe("low");
    expect(applyStepUp("low", "momentum")).toBe("steady"); expect(applyStepUp("steady", "momentum")).toBe("momentum"); expect(applyStepUp("momentum", "low")).toBe("low"); expect(applyStepUp(null, "momentum")).toBe("steady");
  });
  it("الحالة من المؤشرات، والالتزام متوسط متحرك أُسّي", () => {
    expect(followThrough([1, 1, 0])).toBeCloseTo(0.7, 3);
    expect(computeState({ followThrough: 0.8, activeDays7: 5, winsLast24h: 2, ignoredInRow: 0, daysSinceOpen: 0, breakMode: false })).toBe("momentum");
    expect(computeState({ followThrough: 0.8, activeDays7: 5, winsLast24h: 1, ignoredInRow: 0, daysSinceOpen: 0, breakMode: false })).toBe("steady");
    expect(computeState({ followThrough: 0.3, activeDays7: 5, winsLast24h: 2, ignoredInRow: 0, daysSinceOpen: 0, breakMode: false })).toBe("low");
    expect(computeState({ followThrough: null, activeDays7: 2, winsLast24h: 0, ignoredInRow: 0, daysSinceOpen: 1, breakMode: false })).toBe("low");
    expect(computeState({ followThrough: 0.9, activeDays7: 6, winsLast24h: 3, ignoredInRow: 3, daysSinceOpen: 0, breakMode: false })).toBe("low");
    expect(computeState({ followThrough: null, activeDays7: 0, winsLast24h: 0, ignoredInRow: 0, daysSinceOpen: 3, breakMode: false })).toBe("away");
    expect(computeState({ followThrough: null, activeDays7: 0, winsLast24h: 0, ignoredInRow: 0, daysSinceOpen: 3, breakMode: true })).not.toBe("away");
    expect(forbidsBacklogCounts("low")).toBe(true); expect(forbidsBacklogCounts("steady")).toBe(false);
  });
  it("4: جلسة تركيز ⇒ مشغول؛ 5: غياب 10 ساعات مع 4 من 5 ⇒ منتج؛ إنجازان رجعيان ⇒ منتج", () => {
    expect(isBusy({ focusActive: true, blockActive: false, scheduledNow: false, inLearnedBusyWindow: false, dndActive: false })).toBe(true);
    expect(isBusy({ focusActive: false, blockActive: false, scheduledNow: false, inLearnedBusyWindow: false, dndActive: false })).toBe(false);
    expect(classifyAbsence({ absenceHours: 10, scheduledCount: 5, doneCount: 4, retroCount: 0 })).toBe("productive");
    expect(classifyAbsence({ absenceHours: 10, scheduledCount: 5, doneCount: 2, retroCount: 0 })).toBe("unproductive");
    expect(classifyAbsence({ absenceHours: 10, scheduledCount: 0, doneCount: 0, retroCount: 2 })).toBe("productive");
    expect(classifyAbsence({ absenceHours: 5, scheduledCount: 5, doneCount: 0, retroCount: 0 })).toBeNull();
  });
  it("6: إنجازات مسجّلة لاحقًا 3 أسابيع الأحد 9 ⇒ نافذة انشغال؛ 7: away 15 يومًا ⇒ أسبوعي؛ بعد 30 يتوقف", () => {
    const w = learnBusyWindows([{ weekday: 0, hour: 9 }, { weekday: 0, hour: 9 }, { weekday: 0, hour: 9 }, { weekday: 1, hour: 9 }]);
    expect(w).toEqual([{ weekday: 0, start_hour: 9, end_hour: 10, evidence_count: 3 }]);
    expect(awayNotificationDue(3, null)).toBe(true); expect(awayNotificationDue(4, 1)).toBe(false); expect(awayNotificationDue(6, 3)).toBe(true);
    expect(awayNotificationDue(15, 3)).toBe(false); expect(awayNotificationDue(15, 7)).toBe(true); expect(awayNotificationDue(31, 30)).toBe(false); expect(awayNotificationDue(2, null)).toBe(false);
  });
});
