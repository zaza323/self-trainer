/** سقف الزيادة على مرحلتين: اكتشاف بلا سقف ← سقف ناعم 50% بتأكيد (ثابت للطفل افتراضيًا)، وحدة واحدة دائمًا مسموحة، المبالغة معلومة لا رجوع. */
import { describe, it, expect } from "vitest";
import { planner, customization } from "@/shared/config";
import { inDiscovery, capFor, capModeFor, checkTarget, overreachPattern, overreachCount, outcomeFor, nextTarget, paceConfig } from "./rules";

const c = paceConfig.cap;
describe("القيم من config", () => {
  it("28 يومًا، 14 يوم نشاط، 50%، 10%، 3 مرات، 50% تحقيق", () => {
    expect([c.discovery.min_days, c.discovery.min_active_days, c.soft_over_baseline_percent, paceConfig.stretch_default_percent, c.overreach_pattern.times, c.overreach_pattern.achieved_ratio_below]).toEqual([28, 14, 50, 10, 3, 0.5]);
  });
});

describe("فترة الاكتشاف (أيهما أبعد)", () => {
  it("تبقى حتى يتحقق الشرطان معًا", () => {
    expect(inDiscovery({ daysSinceStart: 10, activeDays: 20 })).toBe(true);   // الأيام لم تكتمل
    expect(inDiscovery({ daysSinceStart: 40, activeDays: 9 })).toBe(true);    // النشاط لم يكتمل
    expect(inDiscovery({ daysSinceStart: 28, activeDays: 14 })).toBe(false);
  });
  it("خلالها لا سقف: أي هدف مقبول بلا تأكيد، حتى للطفل بسقف ثابت", () => {
    expect(checkTarget({ baseline: 2, target: 50, discovery: true, mode: "hard", confirmed: false })).toMatchObject({ allowed: true, overCap: false, discovery: true });
  });
});

describe("بعد الاكتشاف", () => {
  it("السقف 50% فوق خط الأساس، ولا يمنع وحدة واحدة أبدًا", () => {
    expect(capFor(20)).toBe(30);
    expect(capFor(1)).toBe(2);          // 1.5 < 1+1 ⇒ الوحدة تغلب
    expect(capFor(0.5)).toBe(1.5);
    expect(checkTarget({ baseline: 1, target: 2, discovery: false, mode: "hard", confirmed: false }).allowed).toBe(true);
  });
  it("ناعم: فوق السقف يحتاج تأكيدًا، وبالتأكيد يُقبل ويُعلَّم over_cap", () => {
    expect(checkTarget({ baseline: 20, target: 35, discovery: false, mode: "soft", confirmed: false })).toEqual({ allowed: false, reason: "needs_confirm", cap: 30 });
    expect(checkTarget({ baseline: 20, target: 35, discovery: false, mode: "soft", confirmed: true })).toEqual({ allowed: true, overCap: true, discovery: false, cap: 30 });
    expect(checkTarget({ baseline: 20, target: 30, discovery: false, mode: "soft", confirmed: false })).toMatchObject({ allowed: true, overCap: false });
  });
  it("ثابت: فوق السقف مرفوض حتى مع التأكيد", () => {
    expect(checkTarget({ baseline: 20, target: 35, discovery: false, mode: "hard", confirmed: true })).toEqual({ allowed: false, reason: "over_hard_cap", cap: 30 });
  });
  it("النمط: الطفل يختاره المربي (الافتراضي ثابت)، وغير الطفل ناعم دائمًا", () => {
    expect(capModeFor("child", null)).toBe("hard"); expect(capModeFor("child", "soft")).toBe("soft");
    expect(capModeFor("teen", "hard")).toBe("soft"); expect(capModeFor("adult", null)).toBe("soft");
  });
});

describe("اقتراح التطبيق", () => {
  it("يبقى 10% بحد أدنى وحدة", () => {
    expect(nextTarget(40, paceConfig.stretch_default_percent)).toBe(44);
    expect(nextTarget(2, paceConfig.stretch_default_percent)).toBe(3);
  });
});

describe("المبالغة معلومة لا رجوع", () => {
  it("هدف فوق السقف أو في الاكتشاف غير محقق ⇒ noted، لا stepped_back ولا held", () => {
    expect(outcomeFor({ achievedDays: 1, windowDays: 7, overCap: true, discovery: false })).toBe("noted");
    expect(outcomeFor({ achievedDays: 4, windowDays: 7, overCap: true, discovery: false })).toBe("noted");
    expect(outcomeFor({ achievedDays: 1, windowDays: 7, overCap: false, discovery: true })).toBe("noted");
    expect(outcomeFor({ achievedDays: 6, windowDays: 7, overCap: true, discovery: false })).toBe("achieved");
    expect(outcomeFor({ achievedDays: 1, windowDays: 7, overCap: false, discovery: false })).toBe("stepped_back");
  });
  it("نمط المبالغة بعد 3 أهداف فوق السقف بتحقيق أقل من 50%", () => {
    const miss = { over_cap: true, achieved_ratio: 0.2 }, hit = { over_cap: true, achieved_ratio: 0.9 }, under = { over_cap: false, achieved_ratio: 0.1 };
    expect(overreachPattern([miss, miss, hit, under])).toBe(false);
    expect(overreachPattern([miss, miss, miss])).toBe(true); expect(overreachCount([miss, miss, miss, hit])).toBe(3);
    expect(overreachPattern([miss, miss, { over_cap: true, achieved_ratio: null }])).toBe(false);
  });
});

describe("قيم الوتيرة المعتمدة لا ترجع لقيم قديمة (قفل بعد دمج إعدادات 0.5)", () => {
  const pace = planner.pace as unknown as Record<string, unknown>;
  it("سقف ناعم 50%، اكتشاف 28 يومًا أو 14 يوم نشاط أيهما أبعد، اقتراح 10%، وحدة واحدة دائمًا، ولا أثر لسقف 25% القديم", () => {
    expect(pace.cap).toMatchObject({ soft_over_baseline_percent: 50, discovery: { min_days: 28, min_active_days: 14, rule: "whichever_later" }, overreach_pattern: { times: 3, achieved_ratio_below: 0.5 } });
    expect(pace.stretch_default_percent).toBe(10); expect(pace.min_step_units).toBe(1);
    expect("max_over_baseline_percent" in pace).toBe(false);
    expect(capFor(1)).toBe(2); expect(nextTarget(40, 10)).toBe(44);
  });
  it("الطفل: ولي الأمر يختار صارم/ليّن والافتراضي صارم؛ غير الطفل ليّن", () => {
    expect((pace.cap as { child_default_mode: string; modes: string[] })).toMatchObject({ child_default_mode: "hard", modes: ["hard", "soft"] });
    const entry = customization.catalog.pace_cap_mode as unknown as { values: string[]; default: Record<string, string>; allowed_age_modes: string[] };
    expect(entry).toMatchObject({ values: ["hard", "soft"], default: { child: "hard", teen: "soft", adult: "soft" }, allowed_age_modes: ["child"] });
    expect(capModeFor("child", undefined)).toBe("hard");
  });
});
