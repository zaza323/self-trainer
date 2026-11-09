/**
 * المحرك (0.5 ج.3 RULES-1): كل قرار دالة نقية تأخذ مدخلاتها وقيم config/ فقط — الدرجات، البوابتان، الدعم والتدريب، XP،
 * المرحلة والكثافة، توقيت وسقف الإشعارات، شكل الرد، الوتيرة، أهلية المهمة. هذا الملف نقطة الدخول الوحيدة المعتمدة:
 * اختبار الحدود (src/lib/boundary.test.ts) يتتبع كل ما يستورده هنا (تعديًا) ويرفض أي استيراد لطبقة الذكاء الاصطناعي
 * أو حزمة النموذج أو قاعدة البيانات، وأي Math.random أو Date.now أو new Date() (RULES-5: الوقت والبذرة يُحقنان).
 */
export * as evidence from "@/modules/evidence/rules";
export * as capabilityScore from "@/modules/capabilities/score";
export * as capabilityLevels from "@/modules/capabilities/levels";
export * as gameXp from "@/modules/game/xp";
export * as gameStepXp from "@/modules/game/step-xp";
export * as gameStage from "@/modules/game/stage";
export * as gameAvatar from "@/modules/game/avatar";
export * as gameAchievements from "@/modules/game/achievements";
export * as surprises from "@/modules/game/surprises";
export * as challengeScoring from "@/modules/challenges/scoring";
export * as notificationPlan from "@/modules/notifications/plan";
export * as engagement from "@/modules/engagement/state";
export * as responseModePolicy from "@/modules/companion/response-mode/policy";
export * as responseModeEnforce from "@/modules/companion/response-mode/enforce";
export * as pace from "@/modules/pace/rules";
export * as plannerTiers from "@/modules/planner/tiers";
export * as plannerRecurrence from "@/modules/planner/recurrence";
export * as plannerNlp from "@/modules/planner/nlp";
export * as plannerDayPlan from "@/modules/planner/day-plan";
export * as plannerBridge from "@/modules/planner/bridge";
export * as plannerXp from "@/modules/planner/xp";
export * as plannerHabits from "@/modules/planner/habits";
export * as plannerEvidenceValues from "@/modules/planner/evidence-values";
export * as plannerFocus from "@/modules/planner/focus";
export * as plannerReminders from "@/modules/planner/reminders";
export * as missionEligibility from "@/modules/engine/select";
export * as missionStateMachine from "@/modules/missions/state-machine";
export * as rewardTriggers from "@/modules/rewards/triggers";
export * as settingsResolve from "@/modules/settings/resolve";
export * as safetyKeywords from "@/modules/safety/classify";
export * as goalsTree from "@/modules/goals/tree";
export * as muhasaba from "@/modules/muhasaba/flow";
export * as openers from "@/modules/moments/openers";
export * as rest from "@/modules/rest/suggest";
export * as followups from "@/modules/followups/compute";
export * as mirror from "@/modules/mirror/reconstruct";
export * as mirrorSuggest from "@/modules/mirror/suggest";
export * as dayText from "@/modules/mirror/day-text";
