/** وحدة المرافق الذكي (AI-1..16، 7.1–7.6). الأدلة والقدرات واللعبة لا تعتمد عليها. */
export { anthropicCaller, aiEnabled, resolveModelId } from "./model";
export type { ModelCaller, ModelRequest, ModelResponse } from "./model";
export { runFunction, fakeCaller, callsToday } from "./runtime";
export type { RunResult } from "./runtime";
export { personaSystem, PROMPT_VERSION } from "./prompts";
export * from "./schemas";
export { goalBuilderTurn, verifyGoalOutput, fixedGoalTurn } from "./functions/goal-builder";
export { reflectionCoachTurn, verifyReflectionOutput, fixedReflectionTurn } from "./functions/reflection-coach";
export { selectWithAi, applySelectorRules } from "./functions/mission-selector";
export { classifyTask, verifyClassifier } from "./functions/task-classifier";
export { narrate, weeklySummary, normalizeStrategy } from "./functions/narrator-summary-normalizer";
export { adviseAdaptation, verifyAdvisor, draftTemplate, verifyDraft, templateDrafterOutput } from "./functions/adaptation-advisor-drafter";
export { handlePlayerMessage, getOrCreateSession, requestHuman, releaseStaleHandoff, disclosureLine, chatMinutesToday } from "./chat/service";
export type { ChatContext, ChatResult, ChatMode } from "./chat/service";
