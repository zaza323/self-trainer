import { describe, it, expect } from "vitest";
import { selectSuggestions, adaptiveDifficulty, type HistoryItem, type CapabilityStateLite } from "./select";
import { loadTemplatesFromContent } from "@/modules/library/content";
import { CAPABILITY_IDS } from "@/shared/config";

const templates = loadTemplatesFromContent();
const states = (over: Partial<Record<string, Partial<CapabilityStateLite>>> = {}): CapabilityStateLite[] =>
  CAPABILITY_IDS.map((c) => ({ capability_id: c, training_level: "simulated", support_level: "L1_hint", mastered: false, next_mastery_check_at: null, ...(over[c] ?? {}) }));
const base = { ageMode: "teen" as const, today: "2026-11-05", templates, history: [] as HistoryItem[], states: states(), focusCapabilities: [] as never[], dailyCount: 3, breakMode: false };

describe("محرك الاقتراح (ENGINE-1/3/6) على capability_states", () => {
  it("مستخدم جديد: 3 مهام simulated بميكانيكيات وقدرات مختلفة، دعم من الحالة", () => {
    const s = selectSuggestions(base);
    expect(s).toHaveLength(3);
    expect(new Set(s.map((x) => x.template.mechanic)).size).toBe(3);
    for (const x of s) { expect(x.template.training_level).toBe("simulated"); expect(x.support_level).toBe("L1_hint"); expect(x.is_mastery_check).toBe(false); }
  });
  it("حتمي", () => {
    expect(selectSuggestions(base).map((x) => x.template.id)).toEqual(selectSuggestions(base).map((x) => x.template.id));
  });
  it("مستوى التدريب من الحالة: planning في guided_real → القالب الواقعي", () => {
    const s = selectSuggestions({ ...base, states: states({ planning: { training_level: "guided_real", support_level: "L2_ask" } }), focusCapabilities: ["planning"] as never[], dailyCount: 1 });
    expect(s[0]!.template.training_level).toBe("guided_real");
    expect(s[0]!.support_level).toBe("L2_ask");
  });
  it("أضعف قدرة بثقة كافية تُفضَّل عند غياب التركيز", () => {
    const st = states({ perseverance: { score: 30, confidence: 0.5 }, attention: { score: 80, confidence: 0.6 } });
    const s = selectSuggestions({ ...base, states: st, dailyCount: 1 });
    expect(s[0]!.template.mechanic).toMatch(/face_obstacle|resume/);
    expect(s[0]!.rationale).toContain("أضعف قدرة");
  });
  it("القدرة المتقنة تُستثنى حتى يحين فحصها الدوري، ثم مهمة فحص واحدة من independent_real", () => {
    const st = states({ planning: { mastered: true, training_level: "transfer", support_level: "L3_free", next_mastery_check_at: "2026-12-01" } });
    const s = selectSuggestions({ ...base, states: st, focusCapabilities: ["planning"] as never[], dailyCount: 3 });
    expect(s.every((x) => Object.keys(x.template.capability_weights)[0] !== "planning")).toBe(true);
    const due = selectSuggestions({ ...base, states: states({ planning: { mastered: true, training_level: "transfer", support_level: "L3_free", next_mastery_check_at: "2026-11-01" } }), dailyCount: 1, templates: [...templates, { ...templates.find((t) => t.id === "pa-real-01")!, id: "pa-real-02", training_level: "independent_real" }] });
    expect(due[0]!.is_mastery_check).toBe(true);
    expect(due[0]!.template.training_level).toBe("independent_real");
  });
  it("إحماء من المستوى الأدنى مرة واحدة في الأسبوع فقط", () => {
    const st = states({ attention: { training_level: "guided_real", support_level: "L2_ask" } });
    const attentionOnly = templates.filter((t) => t.mechanic === "resist_distraction");
    const s = selectSuggestions({ ...base, templates: attentionOnly, states: st, dailyCount: 2 });
    expect(s.map((x) => x.template.id)).toEqual(["rd-real-01", "rd-sim-01"]);
    expect(s[1]!.rationale).toContain("إحماء");
    const used: HistoryItem[] = [{ template_id: "rd-sim-01", mechanic: "resist_distraction", primary_capability: "attention", training_level: "simulated", status: "reflected", gate1: true, suggested_for: "2026-11-03" }];
    const s2 = selectSuggestions({ ...base, templates: attentionOnly, states: st, history: used, dailyCount: 2 });
    expect(s2.map((x) => x.template.id)).toEqual(["rd-real-01"]);
  });
  it("ENGINE-3: نجاح سهل ×2 → +1؛ تعثر ×2 → −1؛ وإلا ثبات", () => {
    const easy = (d: number): HistoryItem => ({ template_id: "x", mechanic: "m", primary_capability: "c", training_level: "simulated", status: "reflected", gate1: true, gate2: "shown", hints_used: 0, difficulty: d, suggested_for: "2026-11-01" });
    const hard = (d: number): HistoryItem => ({ ...easy(d), gate1: false, gate2: "not_yet" });
    expect(adaptiveDifficulty(2, [easy(2), easy(2)])).toBe(3);
    expect(adaptiveDifficulty(2, [hard(2), hard(2)])).toBe(1);
    expect(adaptiveDifficulty(2, [easy(3), hard(3)])).toBe(3);
    expect(adaptiveDifficulty(2, [])).toBe(2);
    expect(adaptiveDifficulty(5, [easy(5), easy(5)])).toBe(5);
    expect(adaptiveDifficulty(2, [{ ...easy(2), hints_used: 1 }, easy(2)])).toBe(2);
  });
  it("وضع الاستراحة ولا تكرار لقالب مفتوح", () => {
    expect(selectSuggestions({ ...base, breakMode: true })).toEqual([]);
    const history: HistoryItem[] = [{ template_id: "rd-sim-01", mechanic: "resist_distraction", primary_capability: "attention", training_level: "simulated", status: "planned", gate1: null, suggested_for: "2026-11-05" }];
    const s = selectSuggestions({ ...base, history });
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.template.id)).not.toContain("rd-sim-01");
  });
});
