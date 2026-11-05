/** وحدة المكافآت الواقعية والإنجازات الخاصة (REWARD-1..8، GAME-10). لا تعتمد على companion ولا adaptation. */
export { validateTrigger, triggerSatisfied, isCapabilityId } from "./triggers";
export type { TriggerType, TriggerParams, TriggerFacts, TriggerValidation } from "./triggers";
export { evaluateRewardTriggers } from "./service";
