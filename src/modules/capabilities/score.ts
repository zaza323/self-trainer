/**
 * درجة القدرة والثقة (الملحق أ.3) — دالة نقية حتمية. كل الثوابت من config/scoring.json.
 */
import { scoring } from "@/shared/config";

export type ScoredEvent = { value: number; weight: number; context_tag: string; created_at: string | Date };

export type CapabilityScore = {
  score: number;        // 0..100، 50 = محايد
  confidence: number;   // 0..1
  mass: number;
  raw: number;
  n_ctx: number;
};

const cfg = scoring.capability_score;
const DAY = 86400000;

export function computeCapabilityScore(events: ScoredEvent[], now: Date): CapabilityScore {
  let mass = 0, num = 0;
  const ctxMass = new Map<string, number>();
  for (const e of events) {
    const ageDays = Math.max(0, (now.getTime() - new Date(e.created_at).getTime()) / DAY);
    const w = e.weight * Math.pow(0.5, ageDays / cfg.half_life_days);
    mass += w;
    num += w * e.value;
    ctxMass.set(e.context_tag, (ctxMass.get(e.context_tag) ?? 0) + w);
  }
  const raw = mass > 0 ? num / (mass + cfg.shrinkage_k) : 0;
  const score = Math.round(((raw + 1) / 2) * 100);
  const n_ctx = [...ctxMass.values()].filter((m) => m >= cfg.context_min_weight).length;
  const conf_mass = 1 - Math.exp(-mass / cfg.confidence_mass_scale);
  const conf_ctx = Math.min(1, n_ctx / cfg.contexts_for_full_confidence);
  const confidence = conf_mass * (0.5 + 0.5 * conf_ctx);
  return { score, confidence: Math.round(confidence * 1e4) / 1e4, mass: Math.round(mass * 1e4) / 1e4, raw: Math.round(raw * 1e4) / 1e4, n_ctx };
}

export type ConfidenceBand = "unknown" | "tentative" | "full";
export type ScoreBand = "needs_support" | "growing" | "strong";

export function confidenceBand(confidence: number): ConfidenceBand {
  const b = scoring.display.confidence_bands;
  return confidence < b.unknown_below ? "unknown" : confidence < b.tentative_below ? "tentative" : "full";
}
export function scoreBand(score: number): ScoreBand {
  const b = scoring.display.score_bands;
  return score < b.needs_support_below ? "needs_support" : score <= b.growing_below ? "growing" : "strong";
}

/** MAP-4: الانخفاض يُعرض عند هبوط ≥ N نقاط عن لقطة قبل X يومًا والثقة في الطرفين ≥ الحد. */
export function isDecline(current: { score: number; confidence: number }, past: { score: number; confidence: number } | null): boolean {
  if (!past) return false;
  const d = scoring.display.decline;
  return past.score - current.score >= d.min_drop_points && current.confidence >= d.min_confidence && past.confidence >= d.min_confidence;
}
