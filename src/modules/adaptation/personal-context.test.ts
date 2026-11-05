import { describe, it, expect } from "vitest";
import { validateContextItem, addContextItem, emptyContext } from "./personal-context";
import { customization } from "@/shared/config";

describe("سياق الحياة (4.13.1)", () => {
  it("يرفض المعلومات الصحية والمواقع الدقيقة وأرقام الهواتف", () => {
    expect(validateContextItem("interests", "كرة القدم يوم الثلاثاء").ok).toBe(true);
    expect(validateContextItem("routine", "أتناول دواء الصباح")).toMatchObject({ ok: false, reason: "health" });
    expect(validateContextItem("contexts", "شارع الجامعة عمارة 5")).toMatchObject({ ok: false, reason: "precise_location" });
    expect(validateContextItem("contexts", "رقمي 0791234567")).toMatchObject({ ok: false, reason: "phone" });
    expect(validateContextItem("interests", "   ")).toMatchObject({ ok: false, reason: "empty" });
  });
  it("حد العناصر لكل حقل ولا تكرار", () => {
    let pc = emptyContext();
    for (let i = 0; i < customization.personal_context.max_items_per_field; i++) { const r = addContextItem(pc, "interests", `هواية ${i}`); expect(r.ok).toBe(true); if (r.ok) pc = r.pc; }
    expect(addContextItem(pc, "interests", "زيادة")).toMatchObject({ ok: false, reason: "max_items" });
    const dup = addContextItem(pc, "interests", "هواية 0");
    expect(dup.ok && dup.pc.interests.length).toBe(customization.personal_context.max_items_per_field);
  });
});
