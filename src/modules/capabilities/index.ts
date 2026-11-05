/** وحدة القدرات (MAP-1..5، أ.3، أ.5، أ.6). لا تعتمد على companion ولا adaptation. */
export { computeCapabilityScore, confidenceBand, scoreBand, isDecline } from "./score";
export type { CapabilityScore, ScoredEvent, ConfidenceBand, ScoreBand } from "./score";
export { decideSupport, decideTraining, applyMasteryCheck, nextMasteryCheckDate, effectiveSupport } from "./levels";
export type { CapMissionSummary, SupportDecision, TrainingDecision } from "./levels";
