/**
 * طبقة الذكاء الاصطناعي (0.5 ج.3 RULES-2): الملفات التي تستدعي النموذج أو تبني طلباته أو تتحقق من مخرجاته.
 * - حزمة النموذج تُستورد في src/lib/ai/client.ts وحده.
 * - لا تكتب هذه الملفات إلا في ai.json › boundary.allowed_write_targets، ولا تستورد (تعديًا) أي ملف خارجها يكتب في قاعدة البيانات.
 * المسارات هنا مرجع اختبار الحدود؛ أي ملف جديد يستدعي النموذج يُضاف إليها.
 */
export const AI_LAYER_FILES = [
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
