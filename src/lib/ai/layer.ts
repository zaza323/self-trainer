/**
 * طبقة الذكاء الاصطناعي (0.5 ج.3 RULES-2): الملفات التي تستدعي النموذج أو تبني طلباته أو تتحقق من مخرجاته.
 * - حزمة النموذج تُستورد في src/lib/ai/client.ts وحده.
 * - لا تكتب هذه الملفات إلا في ai.json › boundary.allowed_write_targets، ولا تستورد (تعديًا) أي ملف خارجها يكتب في قاعدة البيانات.
 * المسارات هنا مرجع اختبار الحدود؛ أي ملف جديد يستدعي النموذج يُضاف إليها.
 */
export const AI_LAYER_FILES = [
  "src/lib/ai/layer.ts",
  "src/lib/ai/client.ts",
  "src/lib/ai/text-guard.ts",
  "src/lib/ai/health.ts",
  "src/modules/companion/model.ts",
  "src/modules/companion/runtime.ts",
  "src/modules/companion/prompts.ts",
  "src/modules/companion/schemas.ts",
  "src/modules/companion/functions/adaptation-advisor-drafter.ts",
  "src/modules/companion/functions/goal-builder.ts",
  "src/modules/companion/functions/mission-selector.ts",
  "src/modules/companion/functions/muhasaba-coach.ts",
  "src/modules/companion/functions/narrator-summary-normalizer.ts",
  "src/modules/companion/functions/reflection-coach.ts",
  "src/modules/companion/functions/task-classifier.ts",
  "src/modules/companion/chat/ai.ts",
  "src/modules/planner/ai.ts",
  "src/modules/planner/reflection-ai.ts",
  "src/modules/safety/ai.ts",
] as const;

export const SDK_PACKAGES = ["@anthropic-ai/sdk", "openai", "@google/generative-ai"] as const;
export const SDK_ALLOWED_FILE = "src/lib/ai/client.ts";

/** ملفات تعيد تصدير الطبقة: استيرادها = استيراد الطبقة. */
export const AI_BARRELS = ["src/modules/companion/index.ts"] as const;

/** مواضع ملفات الطبقة: أي ملف غير اختباري فيها يجب أن يكون في AI_LAYER_FILES (ملف جديد لا يفلت من المدقق لأنه غير مسجل). */
export const AI_LAYER_PATTERNS = [/^src\/lib\/ai\//, /^src\/modules\/companion\/functions\//, /(^|[\/-])ai\.ts$/] as const;

/**
 * المنسّقون (orchestrators): الملفات الوحيدة خارج الطبقة المسموح لها باستيراد الطبقة أو إحدى واجهاتها (استيراد وقت التشغيل).
 * تأخذ مخرج الذكاء الاصطناعي المتحقق وتقرر بالقواعد. أي ملف آخر يستورد الطبقة يفشّل src/lib/boundary.test.ts،
 * وأي مدخل هنا لم يعد يستورد الطبقة يفشّله أيضًا (القائمة لا تتضخم). استدعاء runFunction نفسه محصور في الطبقة.
 */
export const AI_ORCHESTRATORS = [
  "src/app/api/companion/stream/route.ts",
  "src/app/api/cron/tick/route.ts",
  "src/app/app/chat/page.tsx",
  "src/app/app/goals/new/page.tsx",
  "src/app/app/missions/[id]/page.tsx",
  "src/app/app/missions/new/page.tsx",
  "src/app/app/planner/[id]/page.tsx",
  "src/app/app/planner/page.tsx",
  "src/app/guardian/[playerId]/chat/page.tsx",
  "src/app/guardian/[playerId]/missions/new/page.tsx",
  "src/app/guardian/[playerId]/summary/page.tsx",
  "src/modules/adaptation/service.ts",
  "src/modules/companion/actions.ts",
  "src/modules/companion/chat/service.ts",
  "src/modules/engine/service.ts",
  "src/modules/life/actions.ts",
  "src/modules/mirror/actions.ts",
  "src/modules/missions/actions.ts",
  "src/modules/moments/actions.ts",
  "src/modules/muhasaba/actions.ts",
  "src/modules/muhasaba/service.ts",
  "src/modules/pace/components/review-section.tsx",
  "src/modules/planner/actions-phase11.ts",
  "src/modules/planner/reflection-evidence.ts",
  "src/modules/safety/service.ts",
] as const;
