/**
 * نص الموقف المعروض (0.5 أ.5): إن كانت المهمة مربوطة بعنصر من حياة المستخدم (variables.life_entry_text) يركّبه الخادم
 * «حسب ما حكيت: {نص العنصر}. {سؤال القالب}»؛ وإلا نص القالب بمتغيراته. الذكاء الاصطناعي لا يكتب الموقف. دالة نقية.
 */
import type { AgeMode } from "@/shared/config";
import { textByMode, fillVariables, type MissionTemplate } from "./schema";
import { composeScenario, SCENARIO_VARIABLE } from "@/modules/lifelog/rules";

export function scenarioText(template: Pick<MissionTemplate, "situation" | "life_binding">, mode: AgeMode, variables: Record<string, string | number>): string {
  const question = fillVariables(textByMode(template.situation, mode), variables);
  const entry = variables[SCENARIO_VARIABLE];
  return template.life_binding !== "none" && typeof entry === "string" && entry.trim() ? composeScenario(entry, question) : question;
}
