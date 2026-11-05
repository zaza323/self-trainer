/** أ.11 اختبار 3 (المثال المحسوب) واختبار 7 (سياق واحد ≤ 0.67) */
import { describe, it, expect } from "vitest";
import { computeCapabilityScore, confidenceBand, scoreBand, isDecline } from "./score";
import { decideSupport, decideTraining, applyMasteryCheck, effectiveSupport } from "./levels";

const now = new Date("2026-11-05T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
const ev = (value: number, weight: number, age: number, ctx: string) => ({ value, weight, created_at: daysAgo(age), context_tag: ctx });

describe("أ.11 اختبار 3 — المثال المحسوب (الانتباه)", () => {
  const first3 = [ev(-0.4, 0.6, 21, "in_app"), ev(0.3, 0.6, 14, "in_app"), ev(0.6, 0.8, 3, "study")];
  const today2 = [ev(0.8, 0.8, 0, "in_app"), ev(0.8, 0.8, 0, "in_app")];
  it("قبل اليوم: 56% وثقة 0.246 → لا نعرف بعد", () => {
    const r = computeCapabilityScore(first3, now);
    expect(r.score).toBe(56);
    expect(Math.abs(r.confidence - 0.246)).toBeLessThanOrEqual(0.001); // الملحق يعرض 0.246 (مقطوعة)؛ القيمة الدقيقة 0.2466
    expect(Math.abs(r.mass - 1.403)).toBeLessThan(0.001);
    expect(confidenceBand(r.confidence)).toBe("unknown");
  });
  it("بعد اليوم: 67% وثقة 0.44 → مبدئي", () => {
    const r = computeCapabilityScore([...first3, ...today2], now);
    expect(r.score).toBe(67);
    expect(Math.round(r.confidence * 100) / 100).toBe(0.44);
    expect(Math.abs(r.mass - 3.003)).toBeLessThan(0.001);
    expect(confidenceBand(r.confidence)).toBe("tentative");
    expect(scoreBand(r.score)).toBe("strong");
  });
  it("بلا أدلة: 50 محايد وثقة 0", () => {
    expect(computeCapabilityScore([], now)).toMatchObject({ score: 50, confidence: 0 });
  });
});

describe("أ.11 اختبار 7 — سياق واحد لا يتجاوز ثقة ≈ 0.67", () => {
  it("حتى مع 200 دليل ثقيل في سياق واحد", () => {
    const many = Array.from({ length: 200 }, (_, i) => ev(0.9, 1.0, i % 5, "home"));
    const r = computeCapabilityScore(many, now);
    expect(r.confidence).toBeLessThanOrEqual(0.67);
    expect(r.confidence).toBeGreaterThan(0.6);
    const three = Array.from({ length: 200 }, (_, i) => ev(0.9, 1.0, i % 5, ["home", "study", "sport"][i % 3]!));
    expect(computeCapabilityScore(three, now).confidence).toBeGreaterThan(0.9);
  });
});

describe("MAP-4 الانخفاض", () => {
  it("≥ 10 نقاط والثقة في الطرفين ≥ 0.35", () => {
    expect(isDecline({ score: 55, confidence: 0.5 }, { score: 66, confidence: 0.5 })).toBe(true);
    expect(isDecline({ score: 55, confidence: 0.3 }, { score: 66, confidence: 0.5 })).toBe(false);
    expect(isDecline({ score: 60, confidence: 0.5 }, { score: 66, confidence: 0.5 })).toBe(false);
    expect(isDecline({ score: 60, confidence: 0.5 }, null)).toBe(false);
  });
});

describe("أ.5 مستويات الدعم", () => {
  const ok = { gate2: "shown" as const, abandoned: false, hints_used: 0, training_level: "simulated" as const };
  it("رفع: 3 shown من آخر 5، تلميحات ≤ 1، لا تخلٍ، ثقة ≥ 0.35، ≥ 3 منذ آخر تغيير", () => {
    expect(decideSupport("L1_hint", [ok, ok, { ...ok, gate2: "partial" }, ok, { ...ok, hints_used: 1 }], 3, 0.4)).toMatchObject({ level: "L2_ask", change: "up" });
    expect(decideSupport("L1_hint", [ok, ok, ok], 2, 0.4).change).toBe("none");
    expect(decideSupport("L1_hint", [ok, ok, ok, { ...ok, hints_used: 2 }], 3, 0.4).change).toBe("none");
    expect(decideSupport("L1_hint", [ok, ok, ok, { ...ok, abandoned: true }], 3, 0.4).change).toBe("none");
    expect(decideSupport("L1_hint", [ok, ok, ok], 3, 0.2).change).toBe("none");
    expect(decideSupport("L3_free", [ok, ok, ok], 5, 0.9).change).toBe("none");
  });
  it("خفض: (not_yet + abandoned) ≥ 2 من آخر 3، ≥ 2 منذ آخر تغيير، L0 أدنى حد", () => {
    const bad = { ...ok, gate2: "not_yet" as const };
    expect(decideSupport("L2_ask", [bad, { ...ok, abandoned: true, gate2: null }, ok], 2, 0.5)).toMatchObject({ level: "L1_hint", change: "down" });
    expect(decideSupport("L2_ask", [bad, bad, ok], 1, 0.5).change).toBe("none");
    expect(decideSupport("L0_instruct", [bad, bad], 5, 0.5).change).toBe("none");
  });
});

describe("أ.6 مستويات التدريب", () => {
  const shown = (lvl: "simulated" | "guided_real" | "independent_real") => ({ gate2: "shown" as const, abandoned: false, hints_used: 0, training_level: lvl });
  it("simulated → guided_real بعد 3 shown وثقة ≥ 0.35", () => {
    expect(decideTraining({ current: "simulated", mastered: false, missions: [shown("simulated"), shown("simulated"), shown("simulated")], supportLevel: "L1_hint", score: 50, confidence: 0.35, transferReports: [] })).toMatchObject({ level: "guided_real", change: true });
    expect(decideTraining({ current: "simulated", mastered: false, missions: [shown("simulated"), shown("simulated"), shown("simulated")], supportLevel: "L1_hint", score: 50, confidence: 0.2, transferReports: [] }).change).toBe(false);
  });
  it("guided_real → independent_real يحتاج دعم ≥ L2", () => {
    const ms = [shown("guided_real"), shown("guided_real"), shown("guided_real")];
    expect(decideTraining({ current: "guided_real", mastered: false, missions: ms, supportLevel: "L1_hint", score: 60, confidence: 0.5, transferReports: [] }).change).toBe(false);
    expect(decideTraining({ current: "guided_real", mastered: false, missions: ms, supportLevel: "L2_ask", score: 60, confidence: 0.5, transferReports: [] }).level).toBe("independent_real");
  });
  it("independent_real → transfer يحتاج تقرير نقل ناجحًا؛ transfer → متقنة بسياقين ودرجة وثقة ودعم L3", () => {
    const ms = [shown("independent_real"), shown("independent_real")];
    expect(decideTraining({ current: "independent_real", mastered: false, missions: ms, supportLevel: "L3_free", score: 70, confidence: 0.7, transferReports: [] }).change).toBe(false);
    expect(decideTraining({ current: "independent_real", mastered: false, missions: ms, supportLevel: "L3_free", score: 70, confidence: 0.7, transferReports: [{ worked: true, context_tag: "home" }] }).level).toBe("transfer");
    const tr = [{ worked: true, context_tag: "home" }, { worked: true, context_tag: "study" }];
    expect(decideTraining({ current: "transfer", mastered: false, missions: [], supportLevel: "L3_free", score: 65, confidence: 0.65, transferReports: tr }).mastered).toBe(true);
    expect(decideTraining({ current: "transfer", mastered: false, missions: [], supportLevel: "L2_ask", score: 65, confidence: 0.65, transferReports: tr }).mastered).toBe(false);
    expect(decideTraining({ current: "transfer", mastered: false, missions: [], supportLevel: "L3_free", score: 65, confidence: 0.65, transferReports: [{ worked: true, context_tag: "home" }, { worked: true, context_tag: "home" }] }).mastered).toBe(false);
  });
  it("الفحص الدوري: الفشل يعيد independent_real ويخفض الدعم بحد أدنى L2", () => {
    expect(applyMasteryCheck("shown", "L3_free")).toEqual({ mastered: true, training_level: "transfer", support_level: "L3_free" });
    expect(applyMasteryCheck("partial", "L3_free")).toEqual({ mastered: false, training_level: "independent_real", support_level: "L2_ask" });
    expect(applyMasteryCheck("not_yet", "L2_ask")).toEqual({ mastered: false, training_level: "independent_real", support_level: "L2_ask" });
  });
  it("تجاوز المربي المؤقت يخفض فقط وحتى انتهاء المدة", () => {
    expect(effectiveSupport("L3_free", { level: "L2_ask", until: "2099-01-01" }, now)).toBe("L2_ask");
    expect(effectiveSupport("L1_hint", { level: "L2_ask", until: "2099-01-01" }, now)).toBe("L1_hint");
    expect(effectiveSupport("L3_free", { level: "L2_ask", until: "2020-01-01" }, now)).toBe("L3_free");
  });
});
