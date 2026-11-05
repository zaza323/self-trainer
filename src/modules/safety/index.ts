/** وحدة الأمان (AI-5، 7.4، GUARD-2، NOTIF-5). */
export { keywordSafety, normalizeArabic, mergeSafety } from "./classify";
export { classifyText, safeResponse, raiseSafetyFlag } from "./service";
export type { SafetyVerdict } from "./service";
