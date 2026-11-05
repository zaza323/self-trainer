/** وحدة الأدلة (GATE-2..6، أ.2، أ.4). لا تعتمد على companion ولا adaptation. */
export { evaluateMission, computeGate2, evidenceWeight, predictionValue, hintValue } from "./rules";
export { evaluateAndRecord, recomputeSnapshots } from "./service";
export type { EvaluationReport } from "./service";
export type { MissionEvalInput, MissionEvaluation, EvidenceEvent, EvidenceCandidate, Gate2, EvidenceSource, EvidenceType } from "./rules";
