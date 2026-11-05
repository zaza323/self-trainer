/** وحدة اللعبة (الغلاف): GAME-1..9. لا تعتمد على companion ولا adaptation. */
export { missionXp, totalXp, applyDailyCap, levelForXp } from "./xp";
export type { XpInput, XpAward } from "./xp";
export { nextStage, computeIntensity, avgSupport, visibleElements, GAME_ELEMENTS } from "./stage";
export type { IncentiveStage, GameElement, StageInput } from "./stage";
export { avatarPoints, avatarStage, displayedAvatarStage } from "./avatar";
export { isComeback, comebackTierReached, isMindfulAbandon, newContextCapabilities, qualifiesPlayLess } from "./achievements";
export type { PlayLessInput, AchievementCode } from "./achievements";
export { afterMissionReflected, refreshGameState, evaluatePlayLess, getGameView } from "./service";
export type { GameReport, GameView } from "./service";
// تعديل 0.3
export { stepXp, stepXpStopped } from "./step-xp";
export type { StepXpInput, StepXpAward } from "./step-xp";
export { rollSurprise, seededRng, hashSeed } from "./surprises";
export type { Surprise, SurpriseKind, SurpriseInput } from "./surprises";
export { awardStepXp, maybeSurprise } from "./service";
