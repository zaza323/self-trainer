/** 0.5 ج.5-3 حارس الأرقام والتواريخ (RULES-4) بثلاث حالات + الكلمات العربية. */
import { describe, it, expect } from "vitest";
import { guardText, extract } from "./text-guard";

describe("حارس الأرقام والتواريخ", () => {
  it("رقم صحيح يمر (بالأرقام أو الأرقام الهندية)", () => {
    expect(guardText(["خلصت 3 مهام هالأسبوع"], "done_count=3")).toEqual({ ok: true });
    expect(guardText(["خلصت ٣ مهام"], "done_count=3")).toEqual({ ok: true });
  });
  it("رقم غير موجود يسقط — «خمس مهام» والمدخل 3", () => {
    expect(guardText(["خلصت خمس مهام"], "done_count=3")).toEqual({ ok: false, violations: ["number:5"] });
    expect(guardText(["خلصت 4 مهام"], "done_count=3").ok).toBe(false);
  });
  it("تاريخ غير موجود يسقط، والموجود يمر بصيغه المختلفة", () => {
    expect(guardText(["موعدك 12/11"], "due=2026-11-09").ok).toBe(false);
    expect(guardText(["موعدك 9/11"], "due=2026-11-09")).toEqual({ ok: true });
    expect(guardText(["موعدك 9 نوفمبر"], "due=2026-11-09")).toEqual({ ok: true });
    expect(guardText(["موعدك 14 نوفمبر"], "due=2026-11-09").ok).toBe(false);
  });
  it("«واحد» أداة لا عدد، وكلمات العدد تُلتقط مع حروف الربط", () => {
    expect(guardText(["سؤال واحد بس"], "")).toEqual({ ok: true });
    expect(extract("وخمس دقايق").numbers).toEqual([5]);
    expect(guardText(["عملت مرتين"], "count=2")).toEqual({ ok: true });
  });
});
