/** ب.11 قواعد P1–P5 النقية + ب.10 المعاد جدولته تلقائيًا لا يولّد أدلة. */
import { describe, it, expect } from "vitest";
import { p1Value, p2Value, p3Value, p4Value, p5Value, convertedTrainingLevel, overdueToReschedule } from "./bridge";

const t = (o: Partial<Parameters<typeof p1Value>[0]> = {}) => ({ estimate_min: 30, actual_min: 30, postpone_count: 0, auto_rescheduled: false, status: "done", cancel_reason: null, ...o });
describe("P1–P5", () => {
  it("P1 = prediction_error بتسامح 1.0؛ بلا تقدير أو فعلي لا دليل", () => {
    expect(p1Value(t())).toBe(1);
    expect(p1Value(t({ actual_min: 45 }))).toBeCloseTo(0);
    expect(p1Value(t({ estimate_min: null }))).toBeNull();
    expect(p1Value(t({ actual_min: null }))).toBeNull();
  });
  it("P2: رجع +0.6، أنهى −0.2، بلا جواب لا شيء", () => { expect(p2Value(true)).toBe(0.6); expect(p2Value(false)).toBe(-0.2); expect(p2Value(null)).toBeNull(); });
  it("P3 عند ≥ 2 تأجيلات فقط", () => { expect(p3Value(t({ postpone_count: 2 }))).toBe(0.6); expect(p3Value(t({ postpone_count: 1 }))).toBeNull(); });
  it("P4: L2+ بلا مساعدة فقط، ولا قيمة سلبية لاستخدامها", () => {
    expect(p4Value({ planningLevel: "L2_ask", userSteps: 1, usedAi: false, autoRescheduled: false })).toBe(0.5);
    expect(p4Value({ planningLevel: "L2_ask", userSteps: 1, usedAi: true, autoRescheduled: false })).toBeNull();
    expect(p4Value({ planningLevel: "L1_hint", userSteps: 3, usedAi: false, autoRescheduled: false })).toBeNull();
    expect(p4Value({ planningLevel: "L3_free", userSteps: 0, usedAi: false, autoRescheduled: false })).toBeNull();
  });
  it("P5: إلغاء بسبب مكتوب فقط", () => {
    expect(p5Value(t({ status: "cancelled", cancel_reason: "ما عادت مهمة" }))).toBe(0.5);
    expect(p5Value(t({ status: "cancelled", cancel_reason: "  " }))).toBeNull();
  });
  it("المعاد جدولته تلقائيًا لا يولّد أي دليل", () => {
    const a = t({ auto_rescheduled: true, postpone_count: 3 });
    expect([p1Value(a), p3Value(a), p5Value({ ...a, status: "cancelled", cancel_reason: "x" }), p4Value({ planningLevel: "L3_free", userSteps: 2, usedAi: false, autoRescheduled: true })]).toEqual([null, null, null, null]);
  });
  it("مستوى مهمة التدريب حسب مستوى تدريب القدرة", () => {
    expect(convertedTrainingLevel(null)).toBe("guided_real"); expect(convertedTrainingLevel("simulated")).toBe("guided_real");
    expect(convertedTrainingLevel("independent_real")).toBe("independent_real"); expect(convertedTrainingLevel("transfer")).toBe("independent_real");
  });
  it("المتأخر = مفتوحة وموعدها قبل اليوم", () => {
    expect(overdueToReschedule([{ status: "open", due_date: "2026-11-01" }, { status: "done", due_date: "2026-11-01" }, { status: "open", due_date: "2026-11-07" }, { status: "open", due_date: null }], "2026-11-07")).toHaveLength(1);
  });
});
