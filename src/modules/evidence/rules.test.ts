/** اختبارات القبول الذهبية (الملحق أ.11): 1، 2، 8 */
import { describe, it, expect } from "vitest";
import { evaluateMission, computeGate2, evidenceWeight, type EvidenceEvent } from "./rules";
import { missionXp, totalXp } from "@/modules/game/xp";
import { loadTemplatesFromContent } from "@/modules/library/content";

const templates = loadTemplatesFromContent();
const rd = templates.find((t) => t.id === "rd-sim-01")!;
const pa = templates.find((t) => t.id === "pa-real-01")!;

const byRule = (events: EvidenceEvent[]) => Object.fromEntries(events.map((e) => [e.rule_id, { cap: e.capability_id, type: e.type, value: e.value, weight: e.weight, source: e.source }]));

describe("أ.11 اختبار 1 — المثال 1: مقاومة المشتت (simulated)، المهارة ظهرت", () => {
  const r = evaluateMission({
    template: rd,
    mission: { id: "m1", status: "reflected", gate1: true, support_level: "L1_hint", strategy_chosen: "s1", custom_strategy: null, custom_strategy_fit: null, prediction: null, actual_duration_min: 5, hints_used: 0,
      distraction_log: [{ choice: "ignore" }, { choice: "break_return" }], interrupted: false, context_tag: "in_app",
      evidence_candidates: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.6 }] },
    hasPriorEvidenceInContext: () => false,
  });
  it("الأدلة الخمسة بالقيم والأوزان حرفيًا", () => {
    const e = byRule(r.events);
    expect(r.events).toHaveLength(5);
    expect(e.r1).toMatchObject({ cap: "attention", type: "distraction_response", value: 0.8, weight: 0.8 });
    expect(e.r2).toMatchObject({ cap: "self_control", type: "distraction_response", value: 0.8, weight: 0.4 });
    expect(e.r3).toMatchObject({ cap: "attention", type: "strategy_fit", value: 0.8, weight: 0.8 });
    expect(e.G2).toMatchObject({ cap: "autonomy", type: "help_needed", value: 1.0, weight: 0.4 });
    expect(e.G4).toMatchObject({ cap: "self_awareness", type: "reflection_quality", value: 0.6, weight: 0.48, source: "ai" });
    expect(e.G1).toBeUndefined();
    expect(e.G3).toBeUndefined();
  });
  it("shown بـ G = 0.8، و40 XP", () => {
    expect(r.gate2).toBe("shown");
    expect(r.gate2_score).toBe(0.8);
    expect(totalXp(missionXp({ gate1: true, gate2: r.gate2, difficulty: 2, trainingLevel: "simulated", incentiveStage: 1, primaryCapabilitySupport: "L1_hint" }))).toBe(40);
  });
});

describe("أ.11 اختبار 2 — المثال 2: موقف قراري (guided_real)، أنجز دون إتقان", () => {
  const r = evaluateMission({
    template: pa,
    mission: { id: "m2", status: "reflected", gate1: true, support_level: "L2_ask", strategy_chosen: null, custom_strategy: "أرتب كل شيء بسرعة", custom_strategy_fit: 0.0, prediction: { minutes: 20 }, actual_duration_min: 25, hints_used: 1,
      distraction_log: [], interrupted: true, context_tag: "home",
      evidence_candidates: [{ capability_id: "thinking", type: "reflection_quality", value: 0.7 }] },
    hasPriorEvidenceInContext: (cap, ctx) => cap === "planning" && ctx === "home",
  });
  it("الأدلة الخمسة حرفيًا", () => {
    const e = byRule(r.events);
    expect(r.events).toHaveLength(5);
    expect(e.r1).toMatchObject({ cap: "planning", type: "strategy_fit", value: 0.0, weight: 0.6, source: "ai" });
    expect(e.r2).toMatchObject({ cap: "self_awareness", type: "prediction_accuracy", value: 0.5, weight: 1.0 });
    expect(e.G1).toMatchObject({ cap: "perseverance", type: "recovery", value: 1.0, weight: 1.0 });
    expect(e.G2).toMatchObject({ cap: "autonomy", type: "help_needed", value: 0.3, weight: 0.5 });
    expect(e.G4).toMatchObject({ cap: "thinking", type: "reflection_quality", value: 0.7, weight: 0.6 });
    expect(e.G3).toBeUndefined();
  });
  it("partial بـ G = 0.3947 (±0.0001)، و35 XP", () => {
    expect(r.gate2).toBe("partial");
    expect(Math.abs(r.gate2_score - 0.3947)).toBeLessThanOrEqual(0.0001);
    expect(totalXp(missionXp({ gate1: true, gate2: r.gate2, difficulty: 3, trainingLevel: "guided_real", incentiveStage: 1, primaryCapabilitySupport: "L2_ask" }))).toBe(35);
  });
  it("G3 يُطبَّق عندما يكون السياق جديدًا (guided_real فقط)", () => {
    const r2 = evaluateMission({ template: pa, mission: { id: "m3", status: "reflected", gate1: true, support_level: "L2_ask", strategy_chosen: "s3", custom_strategy: null, custom_strategy_fit: null, prediction: { minutes: 20 }, actual_duration_min: 20, hints_used: 0, distraction_log: [], interrupted: false, context_tag: "school", evidence_candidates: [] }, hasPriorEvidenceInContext: () => false });
    const e = byRule(r2.events);
    expect(e.G3).toMatchObject({ cap: "planning", type: "novel_context", value: 0.9 });
  });
});

describe("أ.11 اختبار 8 — مهمة كل أدلتها من الذكاء الاصطناعي لا تصل إلى shown", () => {
  it("حتى بقيم 1.0", () => {
    const events: EvidenceEvent[] = ["attention", "self_control"].map((cap, i) => ({ rule_id: `a${i}`, capability_id: cap as "attention", type: "reflection_quality", source: "ai", value: 1.0, rule_weight: 1, weight: evidenceWeight("ai", "L3_free", 1), context_tag: "x", support_level: "L3_free", config_version: "t" }));
    const g = computeGate2(rd, events);
    expect(g.gate2_score).toBe(1);
    expect(g.gate2).toBe("partial");
  });
  it("دليل واحد فقط ولو كان auto لا يكفي لـ shown", () => {
    const g = computeGate2(rd, [{ rule_id: "r", capability_id: "attention", type: "strategy_fit", source: "auto", value: 1, rule_weight: 1, weight: 1, context_tag: "x", support_level: "L2_ask", config_version: "t" }]);
    expect(g.gate2).toBe("partial");
  });
});

describe("XP — قواعد التلاشي (أ.8)", () => {
  it("المرحلة ≥ 2 والدعم L3 → gate1 = 0؛ المرحلة 4 → simulated كله 0", () => {
    expect(totalXp(missionXp({ gate1: true, gate2: "shown", difficulty: 2, trainingLevel: "guided_real", incentiveStage: 2, primaryCapabilitySupport: "L3_free" }))).toBe(25);
    expect(totalXp(missionXp({ gate1: true, gate2: "shown", difficulty: 2, trainingLevel: "simulated", incentiveStage: 4, primaryCapabilitySupport: "L1_hint" }))).toBe(0);
    expect(totalXp(missionXp({ gate1: false, gate2: "not_yet", difficulty: 1, trainingLevel: "guided_real", incentiveStage: 1, primaryCapabilitySupport: "L1_hint" }))).toBe(10);
  });
});
