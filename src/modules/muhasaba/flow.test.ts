/** ز.8: تنتهي بالخطوة القادمة، حد 3 بنود، جلد الذات يُعاد للسلوك، يوم الاستراحة بلا تقصير، child سؤالان، التكرار. */
import { describe, it, expect } from "vitest";
import { stepsFor, lastStep, validateShortfalls, isSelfBlame, reframeLine, replyAffirmsBlame, recurringShortfalls, replyMomentFor } from "./flow";

describe("ز.8", () => {
  it("1/4/6: الخطوات: teen ثلاث تنتهي بـ next؛ يوم استراحة بلا تقصير؛ child سؤالان", () => {
    expect(stepsFor("teen", false)).toEqual(["achieved", "shortfall", "next"]);
    expect(stepsFor("adult", true)).toEqual(["achieved", "next"]);
    expect(stepsFor("child", false)).toEqual(["did_well", "do_better_tomorrow"]);
    expect(lastStep("teen")).toBe("next"); expect(stepsFor("teen", false).at(-1)).toBe(lastStep("teen"));
    expect(replyMomentFor("achieved")).toBe("reflection_secondary"); expect(replyMomentFor("shortfall")).toBe("obstacle_naming"); expect(replyMomentFor("next")).toBe("priority_pick");
  });
  it("2: لا أكثر من 3 بنود، وسبب لواحد على الأقل", () => {
    const s = (n: number, reason: string | null) => Array.from({ length: n }, (_, i) => ({ text: `x${i}`, reason: i === 0 ? reason : null, task_id: null }));
    expect(validateShortfalls(s(4, "r"))).toEqual({ ok: false, reason: "too_many" });
    expect(validateShortfalls(s(2, null))).toEqual({ ok: false, reason: "reason_required" });
    expect(validateShortfalls(s(3, "ضاق الوقت"))).toEqual({ ok: true }); expect(validateShortfalls([])).toEqual({ ok: true });
  });
  it("3: «أنا فاشل» ⇒ رد لا يؤكد الحكم ويعيده لسلوك محدد", () => {
    expect(isSelfBlame("أنا فاشل")).toBe(true); expect(isSelfBlame("ما بنفع لشي")).toBe(true); expect(isSelfBlame("ما خلصت المراجعة")).toBe(false);
    const r = reframeLine("teen", "ما مشيت المراجعة");
    expect(r).toContain("ما مشيت المراجعة"); expect(r).not.toMatch(/فاشل|كسول/); expect(replyAffirmsBlame(r)).toBe(false);
    expect(replyAffirmsBlame("نعم أنت فاشل فعلًا")).toBe(true);
  });
  it("ز.4: التقصير نفسه 3 مرات في أسبوعين", () => {
    const e = (d: string) => ({ local_date: d, shortfalls: [{ text: "المراجعة", reason: null, task_id: "t1" }] });
    expect(recurringShortfalls([e("2026-11-01"), e("2026-11-03"), e("2026-11-05")], "2026-11-07")).toEqual([{ key: "t1", times: 3 }]);
    expect(recurringShortfalls([e("2026-10-01"), e("2026-11-03"), e("2026-11-05")], "2026-11-07")).toEqual([]);
  });
});
