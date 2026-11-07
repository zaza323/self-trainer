/** هـ.11: القيلولة في نافذتها فقط، لا بعد 16:00، المدة لا تتجاوز الفراغ، لا ممنوعات، التهدئة قبل النوم، لا XP ولا أدلة، إنجاز «راحة تجدّد». */
import { describe, it, expect } from "vitest";
import { suggestRest, inWindDown, napAllowed, restfulWeekReached, restXp, restGivesEvidence, restConfig, REST_KEYS, type SuggestInput } from "./suggest";
import { customization } from "@/shared/config";

const enabledTeen = customization.catalog.rest_activities_enabled!.default.teen as string[];
const base: SuggestInput = { ageMode: "teen", nowMin: 14 * 60, enabled: enabledTeen, custom: [], gapMin: null, napEnabled: true, napWindow: ["13:00", "15:30"], napDefaultMin: 20, outcomes: {}, bedtime: null, windDownMin: 30, source: "next" };

describe("هـ.11", () => {
  it("1: 14:00 لمراهق ⇒ القيلولة ضمن أول 3؛ 2: 16:30 ⇒ لا قيلولة", () => {
    expect(suggestRest(base).shown.slice(0, 3).map((s) => s.key)).toContain("nap");
    expect([...suggestRest({ ...base, nowMin: 16 * 60 + 30 }).shown, ...suggestRest({ ...base, nowMin: 16 * 60 + 30 }).more].map((s) => s.key)).not.toContain("nap");
    expect(napAllowed({ nowMin: 16 * 60 + 15, napEnabled: true, napWindow: ["13:00", "17:00"] })).toBe(false); // nap_latest 16:00 يقصّ النافذة
    expect(napAllowed({ nowMin: 15 * 60 + 45, napEnabled: true, napWindow: ["13:00", "17:00"] })).toBe(true);
  });
  it("3: فراغ 25 دقيقة ⇒ لا مدة أطول من 25؛ القيلولة لا تتجاوز 30", () => {
    const r = suggestRest({ ...base, gapMin: 25 });
    for (const s of [...r.shown, ...r.more]) for (const d of s.durations) expect(d).toBeLessThanOrEqual(25);
    expect(suggestRest(base).shown.find((s) => s.key === "nap")!.durations.every((d) => d <= restConfig.nap_max_min)).toBe(true);
  });
  it("4: لا يظهر أي نشاط من الممنوعات حتى لو طُلب تفعيله", () => {
    const r = suggestRest({ ...base, enabled: [...enabledTeen, ...restConfig.never_suggest] });
    for (const s of [...r.shown, ...r.more]) expect(restConfig.never_suggest).not.toContain(s.key);
    for (const k of restConfig.never_suggest) expect(REST_KEYS).not.toContain(k);
  });
  it("8: قبل target_bedtime بـ 30 دقيقة ⇒ التهدئة ونوم في وقته أولًا؛ 9: child بلا قيلولة افتراضيًا", () => {
    expect(inWindDown(22 * 60 + 40, "23:00", 30)).toBe(true); expect(inWindDown(22 * 60 + 20, "23:00", 30)).toBe(false); expect(inWindDown(23 * 60 + 50, "00:10", 30)).toBe(true);
    const r = suggestRest({ ...base, nowMin: 22 * 60 + 45, bedtime: "23:00", enabled: [...enabledTeen, "sleep_early"] });
    expect(r.windDown).toBe(true); expect(r.shown[0]!.key).toBe("sleep_early");
    const childEnabled = customization.catalog.rest_activities_enabled!.default.child as string[];
    expect(childEnabled).not.toContain("nap");
    expect(customization.catalog.nap_suggestions_enabled!.default.child).toBe(false);
    expect(suggestRest({ ...base, ageMode: "child", enabled: childEnabled, napEnabled: false }).shown.map((s) => s.key)).not.toContain("nap");
  });
  it("6/10: القيلولة تحمل نصيحة المنبّه؛ لا XP ولا أدلة؛ إنجاز بعد 5 أنشطة؛ الذاكرة ترفع الترتيب؛ النشاط المخصص", () => {
    expect(suggestRest(base).shown.find((s) => s.key === "nap")!.alarmAdvice).toBe(true);
    expect(restXp).toBe(0); expect(restGivesEvidence).toBe(false);
    expect(restfulWeekReached(5)).toBe(true); expect(restfulWeekReached(4)).toBe(false);
    const mem = suggestRest({ ...base, nowMin: 17 * 60, outcomes: { stretch: { uses: 3, felt_more_count: 3 } } });
    expect(mem.shown[0]!.key).toBe("stretch"); expect(mem.shown[0]!.reason).toBe("memory");
    const custom = suggestRest({ ...base, nowMin: 17 * 60, custom: [{ id: "c1", title: "أرسم", default_min: 15 }], gapMin: 20 });
    expect([...custom.shown, ...custom.more].some((s) => s.customId === "c1")).toBe(true);
    expect(suggestRest({ ...base, nowMin: 17 * 60, custom: [{ id: "c1", title: "أرسم", default_min: 45 }], gapMin: 20 }).more.some((s) => s.customId === "c1")).toBe(false);
  });
  it("11: لا تتبع للنوم في config", () => { expect(restConfig.wind_down.sleep_tracking).toBe(false); expect(restConfig.no_tracking_of_other_apps).toBe(true); });
});
