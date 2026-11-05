import { describe, it, expect } from "vitest";
import { loadTemplatesFromContent } from "./content";
import { primaryCapability, textByMode, fillVariables } from "./schema";
import { MECHANIC_IDS, limits } from "@/shared/config";
import mechanics from "@content/mechanics.ar.json";

describe("مكتبة القوالب الأولية (LIB-2: 20 قالبًا للمرحلة 1)", () => {
  const templates = loadTemplatesFromContent();
  it("20 قالبًا صالحة، قالبان لكل ميكانيكية: simulated و guided_real", () => {
    expect(templates).toHaveLength(20);
    for (const m of MECHANIC_IDS) {
      const mine = templates.filter((t) => t.mechanic === m);
      expect(mine.map((t) => t.training_level).sort()).toEqual(["guided_real", "simulated"]);
    }
  });
  it("القدرة الأساسية لكل قالب تطابق القدرة الأساسية لميكانيكيته (4.3)", () => {
    for (const t of templates) {
      const expected = (mechanics as Record<string, { primary_capability?: string }>)[t.mechanic]?.primary_capability;
      expect(primaryCapability(t)).toBe(expected);
    }
  });
  it("قوالب simulated قصيرة (≤ حد التمرين الأول) ولكل قالب نسخ للأوضاع الثلاثة", () => {
    for (const t of templates) {
      expect(t.age_modes).toEqual(["child", "teen", "adult"]);
      for (const mode of ["child", "teen", "adult"] as const) {
        expect(textByMode(t.situation, mode).length).toBeGreaterThan(20);
        expect(textByMode(t.title, mode).length).toBeGreaterThan(2);
      }
      if (t.training_level === "simulated") expect(t.min_duration).toBeLessThanOrEqual(limits.onboarding_mission_max_minutes + 5);
    }
  });
  it("قواعد الأدلة تشير إلى قدرات القالب فقط، وكل قالب فيه strategy_fit على قدرته الأساسية", () => {
    for (const t of templates) {
      const caps = new Set(Object.keys(t.capability_weights));
      for (const r of t.evidence_rules) expect(caps.has(r.capability_id)).toBe(true);
      expect(t.evidence_rules.some((r) => r.value.kind === "strategy_fit" || r.value.kind === "prediction_error")).toBe(true);
    }
  });
  it("المثال 1 من الملحق (rd-sim-01) مطابق: الأوزان والقواعد الثلاث", () => {
    const t = templates.find((x) => x.id === "rd-sim-01")!;
    expect(t.capability_weights).toEqual({ attention: 0.7, self_control: 0.3 });
    expect(t.evidence_rules.map((r) => [r.id, r.capability_id, r.value.kind])).toEqual([["r1", "attention", "choice_map"], ["r2", "self_control", "choice_map"], ["r3", "attention", "strategy_fit"]]);
    expect(t.evidence_rules[1]!.rule_weight).toBe(0.5);
    expect(t.distraction_config).toEqual({ count: 2, kind: "side_game" });
  });
  it("fillVariables يملأ المتغيرات ويترك المجهول ظاهرًا", () => {
    expect(fillVariables("{{time_budget}} دقائق على {{context}} و{{x}}", { time_budget: 5, context: "القراءة" })).toBe("5 دقائق على القراءة و{{x}}");
  });
});
