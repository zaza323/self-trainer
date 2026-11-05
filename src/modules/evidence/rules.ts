/**
 * محرك قواعد الأدلة (الملحق أ.2) والبوابة الثانية (أ.4) — دوال نقية حتمية.
 * كل قواعد المهمة تُقيَّم دفعة واحدة عند الانتقال إلى reflected. لا أرقام هنا: كل قيمة من config/scoring.json.
 */
import { scoring, CONFIG_VERSION, type CapabilityId, type SupportLevel, type TrainingLevel } from "@/shared/config";
import { primaryCapability, type MissionTemplate } from "@/modules/library";

export type EvidenceSource = "auto" | "ai" | "self" | "guardian" | "companion";
export type EvidenceType = "strategy_fit" | "prediction_accuracy" | "recovery" | "distraction_response" | "help_needed" | "reflection_quality" | "transfer_report" | "guardian_observation" | "companion_insight" | "novel_context";

export type EvidenceCandidate = { capability_id: CapabilityId; type: "reflection_quality"; value: number; rationale?: string };

export type MissionEvalInput = {
  template: MissionTemplate;
  mission: {
    id: string;
    status: "completed" | "abandoned" | "reflected";
    gate1: boolean;
    support_level: SupportLevel;
    strategy_chosen: string | null;
    custom_strategy: string | null;
    custom_strategy_fit: number | null; // من reflection_coach (المرحلة 4)؛ null = لا دليل strategy_fit للمخصصة
    prediction: { minutes?: number; count?: number } | null;
    actual_duration_min: number | null;
    hints_used: number;
    distraction_log: Array<{ choice: "ignore" | "break_return" | "give_in" }>;
    interrupted: boolean;
    context_tag: string;
    evidence_candidates: EvidenceCandidate[];
  };
  /** هل يوجد دليل سابق لهذه القدرة بنفس context_tag؟ (لقاعدة G3) */
  hasPriorEvidenceInContext: (capability: CapabilityId, contextTag: string) => boolean;
};

export type EvidenceEvent = {
  rule_id: string;
  capability_id: CapabilityId;
  type: EvidenceType;
  source: EvidenceSource;
  value: number;
  rule_weight: number;
  weight: number;
  context_tag: string;
  support_level: SupportLevel;
  config_version: string;
};

export type Gate2 = "shown" | "partial" | "not_yet";
export type MissionEvaluation = { events: EvidenceEvent[]; gate2: Gate2; gate2_score: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** الوزن النهائي = وزن المصدر × مضاعف مستوى الدعم × وزن القاعدة */
export function evidenceWeight(source: EvidenceSource, support: SupportLevel, ruleWeight: number): number {
  return round4(scoring.source_weights[source] * scoring.support_multipliers[support] * ruleWeight);
}

export function predictionValue(actual: number, predicted: number, tolerance: number): number {
  const rel = Math.abs(actual - predicted) / predicted;
  return clamp(1 - (2 * rel) / tolerance, -1, 1);
}

export function hintValue(hints: number, map = scoring.value_defaults.hint_count_map): number {
  return hints === 0 ? map["0"] : hints === 1 ? map["1"] : map["2+"];
}

const SUPPORT_ORDER: SupportLevel[] = ["L0_instruct", "L1_hint", "L2_ask", "L3_free"];
export const supportIndex = (l: SupportLevel) => SUPPORT_ORDER.indexOf(l);

/** يحسب أدلة مهمة واحدة والبوابة الثانية. قاعدة القالب تغلب القاعدة العامة عند تطابق (capability, type). */
export function evaluateMission(input: MissionEvalInput): MissionEvaluation {
  const { template, mission } = input;
  const events: EvidenceEvent[] = [];
  const seen = new Set<string>();
  const push = (e: Omit<EvidenceEvent, "weight" | "context_tag" | "support_level" | "config_version">) => {
    const key = `${e.capability_id}|${e.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push({ ...e, value: round4(clamp(e.value, -1, 1)), weight: evidenceWeight(e.source, mission.support_level, e.rule_weight), context_tag: mission.context_tag, support_level: mission.support_level, config_version: CONFIG_VERSION });
  };

  const mirror = (cap: CapabilityId): number | null => {
    const vals = events.filter((e) => e.capability_id === cap).map((e) => e.value);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  // قواعد القالب
  for (const r of template.evidence_rules) {
    const rw = r.rule_weight ?? 1.0;
    const v = r.value;
    if (v.kind === "choice_map") {
      if (mission.distraction_log.length === 0) continue;
      const vals = mission.distraction_log.map((d) => v.map[d.choice]);
      push({ rule_id: r.id, capability_id: r.capability_id, type: r.type, source: r.source, value: vals.reduce((a, b) => a + b, 0) / vals.length, rule_weight: rw });
    } else if (v.kind === "strategy_fit") {
      if (mission.custom_strategy) {
        if (mission.custom_strategy_fit === null) continue; // لا تقييم بدون reflection_coach
        push({ rule_id: r.id, capability_id: r.capability_id, type: r.type, source: "ai", value: mission.custom_strategy_fit, rule_weight: rw });
      } else {
        const s = template.strategies.find((x) => x.id === mission.strategy_chosen);
        if (!s) continue;
        push({ rule_id: r.id, capability_id: r.capability_id, type: r.type, source: r.source, value: s.fit, rule_weight: rw });
      }
    } else if (v.kind === "prediction_error") {
      const predicted = mission.prediction?.minutes;
      if (!predicted || !mission.actual_duration_min) continue;
      push({ rule_id: r.id, capability_id: r.capability_id, type: r.type, source: r.source, value: predictionValue(mission.actual_duration_min, predicted, v.tolerance), rule_weight: rw });
    } else if (v.kind === "hint_count") {
      push({ rule_id: r.id, capability_id: r.capability_id, type: r.type, source: r.source, value: hintValue(mission.hints_used, v.map), rule_weight: rw });
    } else if (v.kind === "recovery") {
      if (!mission.interrupted) continue;
      push({ rule_id: r.id, capability_id: r.capability_id, type: r.type, source: r.source, value: mission.gate1 ? scoring.value_defaults.recovery.resumed_completed : scoring.value_defaults.recovery.resumed_abandoned_reflected, rule_weight: rw });
    } else if (v.kind === "mirror") {
      const m = mirror(r.capability_id);
      if (m === null) continue;
      push({ rule_id: r.id, capability_id: r.capability_id, type: r.type, source: r.source, value: m, rule_weight: rw });
    } else if (v.kind === "ai_candidate") {
      for (const c of mission.evidence_candidates.filter((c) => c.capability_id === r.capability_id)) {
        push({ rule_id: r.id, capability_id: c.capability_id, type: r.type, source: "ai", value: c.value, rule_weight: rw });
      }
    }
  }

  // القواعد العامة G1–G4
  const g = scoring.global_rules;
  if (mission.interrupted) {
    push({ rule_id: "G1", capability_id: g.G1_recovery.capability, type: "recovery", source: "auto", rule_weight: g.G1_recovery.rule_weight,
      value: mission.gate1 ? scoring.value_defaults.recovery.resumed_completed : scoring.value_defaults.recovery.resumed_abandoned_reflected });
  }
  if (supportIndex(mission.support_level) >= supportIndex(g.G2_help_needed.min_support_level)) {
    push({ rule_id: "G2", capability_id: g.G2_help_needed.capability, type: "help_needed", source: "auto", rule_weight: g.G2_help_needed.rule_weight, value: hintValue(mission.hints_used) });
  }
  const allowedForG4 = new Set<string>([...Object.keys(template.capability_weights), ...g.G4_reflection_quality.extra_allowed_capabilities]);
  for (const c of mission.evidence_candidates.slice(0, g.G4_reflection_quality.max_candidates)) {
    if (!allowedForG4.has(c.capability_id)) continue;
    push({ rule_id: "G4", capability_id: c.capability_id, type: "reflection_quality", source: "ai", rule_weight: g.G4_reflection_quality.rule_weight, value: c.value });
  }
  const primary = primaryCapability(template) as CapabilityId;
  if (!g.G3_novel_context.exclude_training_levels.includes(template.training_level) && !input.hasPriorEvidenceInContext(primary, mission.context_tag)) {
    const m = mirror(primary);
    if (m !== null) push({ rule_id: "G3", capability_id: primary, type: "novel_context", source: "auto", rule_weight: g.G3_novel_context.rule_weight, value: m });
  }

  return { events, ...computeGate2(template, events) };
}

/** البوابة الثانية (أ.4): على قدرات القالب فقط. */
export function computeGate2(template: Pick<MissionTemplate, "capability_weights">, events: EvidenceEvent[]): { gate2: Gate2; gate2_score: number } {
  const weights = template.capability_weights as Record<string, number>;
  const included = events.filter((e) => weights[e.capability_id] !== undefined);
  let num = 0, den = 0;
  for (const e of included) { const cw = weights[e.capability_id]!; num += cw * e.weight * e.value; den += cw * e.weight; }
  const G = den > 0 ? num / den : 0;
  const cfg = scoring.gate2;
  const hasTrusted = included.some((e) => (cfg.shown_requires_sources as string[]).includes(e.source));
  const gate2: Gate2 = G >= cfg.shown_min_score && included.length >= cfg.shown_min_events && hasTrusted ? "shown" : G >= cfg.partial_min_score ? "partial" : "not_yet";
  return { gate2, gate2_score: round4(G) };
}

export type TrainingLevelOrMastered = TrainingLevel | "mastered";
