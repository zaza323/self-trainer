/** وحدة التحديات العادلة (تعديل 0.3 §2). لا لوحة عامة، لا محادثة، لا «فلان تجاوزك»، لا خصم، لا عقوبة انسحاب. */
export { scoreParticipant, computeChallengeScores } from "./scoring";
export type { ParticipantInput, ParticipantScore } from "./scoring";
export { recomputeChallengeScores, tickChallenges, challengesVisible, autoMatch, isMember } from "./service";
export type { ChallengeRow, ParticipantRow } from "./service";
