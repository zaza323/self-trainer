/** وحدة التجربة المغلقة والقياس (المرحلة 8): مقاييس القسم 15، التحذيران المضادان، أحداث منتج مجهّلة، الجاهزية، تصدير/حذف البيانات. */
export { computeCohortMetrics, skillGrowth, transferRate, autonomy, masteryOverAchievement, novelContext, healthyReturn, adaptationAcceptance, warnXpWithoutLearning, warnRewardDisplacesMotivation, weekOf } from "./metrics";
export type { ParticipantData, MetricStatus, Warning, CohortMetrics } from "./metrics";
export { sanitizeEvent, profileHash, track, postHogSender } from "./analytics";
export type { TrackInput, PostHogSender } from "./analytics";
