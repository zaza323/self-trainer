/** وحدة التكيّف (ADAPT-1..8). المرحلة 5: سياق الحياة واقتراحات السياق. المرحلة 7: adaptation_advisor وفعالية القوالب. */
export { validateContextItem, addContextItem, emptyContext, CONTEXT_FIELDS } from "./personal-context";
export type { ContextField, PersonalContext } from "./personal-context";
// المرحلة 7
export { strategyKeyOf, computeStrategyOutcomes, bestStrategy, showMemoryInPlanning, recallLine, shownRate } from "./strategy-outcomes";
export type { StrategyOutcomeRow, OutcomeMission } from "./strategy-outcomes";
export { templateMetricsFrom } from "./template-metrics";
export type { TemplateMetrics, MetricMission } from "./template-metrics";
export { normalizeSuggestion, filterSuggestions, dedupeKeyOf, audienceFor } from "./advisor";
export type { RawSuggestion, Suggestion, AdvisorContext } from "./advisor";
