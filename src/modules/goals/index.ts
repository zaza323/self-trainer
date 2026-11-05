/** وحدة الغايات (GOAL-1، GOAL-3، GOAL-5) — بلا ذكاء اصطناعي في المرحلة 1. */
export { chainToRoot, buildForest, nearestActiveGoal, wouldCycle, depthOf } from "./tree";
export type { GoalNode, GoalTree } from "./tree";
export { getGoals } from "./queries";
export type { GoalRow } from "./queries";
