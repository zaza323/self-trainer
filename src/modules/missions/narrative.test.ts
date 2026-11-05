import { describe, it, expect } from "vitest";
import { buildNarrative, alternatives } from "./narrative";
import { loadTemplatesFromContent } from "@/modules/library/content";

const templates = loadTemplatesFromContent();
const rd = templates.find((t) => t.id === "rd-sim-01")!;
const pa = templates.find((t) => t.id === "pa-real-01")!;

describe("شاشة الوعي بالتقدم النصية (P10)", () => {
  it("المثال 1: تجاهل ثم استراحة، بلا تلميحات، مكتملة", () => {
    const lines = buildNarrative({ status: "reflected", gate1: true, strategy_chosen: "s1", custom_strategy: null, prediction: null, actual_duration_min: 5, hints_used: 0,
      distraction_log: [{ at: "", choice: "ignore" }, { at: "", choice: "break_return" }], interrupted: false }, rd, "teen");
    expect(lines[0]).toBe("أنهيت المهمة.");
    expect(lines.join("\n")).toContain("أحدد مسبقًا ماذا سأفعل حين يظهر المشتت");
    expect(lines.join("\n")).toContain("تجاهلته 1 مرة");
    expect(lines.join("\n")).toContain("لم تطلب أي تلميح");
    expect(lines.join("\n")).not.toMatch(/XP|نقطة/);
  });
  it("المثال 2: استراتيجية مخصصة، توقع 20 والواقع 25، انقطاع وعودة، تلميح واحد", () => {
    const lines = buildNarrative({ status: "completed", gate1: true, strategy_chosen: null, custom_strategy: "أرتب كل شيء بسرعة", prediction: { minutes: 20 }, actual_duration_min: 25, hints_used: 1, distraction_log: [], interrupted: true }, pa, "adult");
    const text = lines.join("\n");
    expect(text).toContain("أرتب كل شيء بسرعة");
    expect(text).toContain("توقعت 20 دقيقة واستغرقت 25");
    expect(text).toContain("الواقع أخذ أكثر");
    expect(text).toContain("عدت وأكملت");
    expect(text).toContain("تلميحًا واحدًا");
  });
  it("التخلي يُعرض بلغة غير عقابية", () => {
    const lines = buildNarrative({ status: "abandoned", gate1: false, strategy_chosen: null, custom_strategy: null, prediction: null, actual_duration_min: null, hints_used: 0, distraction_log: [], interrupted: true }, rd, "child");
    expect(lines[0]).toContain("هذا يحدث");
    expect(lines.join(" ")).toContain("التوقف الواعي");
  });
  it("البدائل تستثني المختارة (MIS-8)", () => {
    const alt = alternatives(pa, "s3", "teen");
    expect(alt).toHaveLength(3);
    expect(alt.map((a) => a.text)).not.toContain("أقسم الوقت: 10 دقائق ترتيب أساسي، 10 تجهيز للخروج");
  });
});
