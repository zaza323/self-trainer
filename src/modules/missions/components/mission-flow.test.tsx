import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), redirect: () => {} }));
import { renderToString } from "react-dom/server";
import { MissionFlow } from "./mission-flow";
import { loadTemplatesFromContent } from "@/modules/library/content";
import type { MissionRow } from "../types";

const rd = loadTemplatesFromContent().find((t) => t.id === "rd-sim-01")!;
const base: MissionRow = {
  id: "00000000-0000-0000-0000-000000000009", profile_id: "p", template_id: "rd-sim-01", template_version: 1, goal_id: null, status: "suggested", difficulty: 2, support_level: "L1_hint",
  variables: { time_budget: 5, context: "قراءة صفحة" }, strategy_chosen: null, custom_strategy: null, custom_strategy_label: null, time_estimate: null, prediction: null,
  actual_duration_min: null, hints_used: 0, distraction_log: [], interruption_reasons: [], checklist_done: [], gate1: null, gate2: null, gate2_score: null,
  started_at: null, completed_at: null, context_tag: null, source: "engine", suggested_for: "2026-11-05", dismissed: false, needs_approval: false, created_at: "", updated_at: "",
};
const props = { template: rd, mode: "teen" as const, reflection: null, reflectionPrompts: ["س1", "س2"], interruptionQuestion: "ما الذي أوقفك؟", narrative: ["أنهيت المهمة."], alternatives: [], distraction: { firstAtFraction: 0.3, spreadFraction: 0.5 }, goalOptions: [{ id: "g", title: "غايتي" }], chain: null };

describe("MissionFlow — شاشة لكل حالة", () => {
  it("suggested: الموقف مملوء المتغيرات + قبول/استبدال", () => {
    const html = renderToString(<MissionFlow {...props} mission={base} />);
    expect(html).toContain("ركّز على قراءة صفحة لمدة 5 دقائق");
    expect(html).toContain("أقبل هذه المهمة");
    expect(html).toContain("استبدل");
  });
  it("chosen: التخطيط بثلاث استراتيجيات وتقدير وقت (MIS-3)", () => {
    const html = renderToString(<MissionFlow {...props} mission={{ ...base, status: "chosen" }} />);
    expect(html).toContain("أحدد مسبقًا ماذا سأفعل حين يظهر المشتت");
    expect(html).toContain('name="time_estimate"');
    expect(html).toContain('name="custom_strategy"');
  });
  it("in_progress: مؤقت، تلميح، توقفت، أكملت، أتخلى (MIS-4/6/11)", () => {
    const html = renderToString(<MissionFlow {...props} mission={{ ...base, status: "in_progress", started_at: new Date().toISOString(), strategy_chosen: "s1", time_estimate: 5 }} />);
    expect(html).toContain('role="timer"');
    expect(html).toContain("أحتاج تلميحًا");
    expect(html).toContain("توقفت");
    expect(html).toContain("أكملت");
    expect(html).toContain("أتخلى عنها");
  });
  it("interrupted: سؤال واحد فقط (MIS-6)", () => {
    const html = renderToString(<MissionFlow {...props} mission={{ ...base, status: "interrupted" }} />);
    expect(html).toContain("ما الذي أوقفك؟");
    expect(html).toContain("أعود الآن");
  });
  it("completed: التأمل بأسئلة ثابتة؛ reflected: شاشة الوعي النصية بلا نقاط", () => {
    const c = renderToString(<MissionFlow {...props} mission={{ ...base, status: "completed", gate1: true }} />);
    expect(c).toContain("س1");
    expect(c).toContain("أنهيت التأمل");
    const r = renderToString(<MissionFlow {...props} mission={{ ...base, status: "reflected", gate1: true }} reflection={{ id: "r", mission_id: base.id, prompts_and_answers: [{ prompt: "س1", answer: "ج1" }], summary: null, created_at: "" }} />);
    expect(r).toContain("ما لاحظناه");
    expect(r).toContain("ج1");
    expect(r).not.toMatch(/XP/);
  });
});
