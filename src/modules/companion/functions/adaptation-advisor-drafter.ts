import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import { customization, MECHANIC_IDS, CAPABILITY_IDS } from "@/shared/config";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "../prompts";
import { adaptationAdvisorOutput, type AdaptationAdvisorOutput } from "../schemas";
import { templateSchema, type MissionTemplate } from "@/modules/library/schema";

/** adaptation_advisor (7.2، ADAPT-4): السقوط = لا اقتراحات هذا الأسبوع. التحقق النهائي (الأنواع والقص) في adaptation/advisor.ts. */
export async function adviseAdaptation(i: { db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode; stats: Record<string, unknown>; currentSettings: Record<string, unknown>; now?: Date }): Promise<{ suggestions: AdaptationAdvisorOutput["suggestions"]; source: "ai" | "fixed" }> {
  const allowed = Object.entries(customization.adaptation.allowed_types).map(([k, v]) => `${k}${v.setting_key ? ` (setting_key=${v.setting_key})` : ""}`).join(", ");
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "adaptation_advisor", profileId: i.profileId, now: i.now,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.adaptation_advisor}\nالأنواع المسموحة: ${allowed}. الميكانيكيات: ${MECHANIC_IDS.join(", ")}. القدرات: ${CAPABILITY_IDS.join(", ")}.`,
    dynamicSystem: `أدلة ${customization.adaptation.lookback_days} يومًا وتوقيت المهام ونتائجها: ${JSON.stringify(i.stats)}\nالإعدادات الحالية: ${JSON.stringify(i.currentSettings)}`,
    messages: [{ role: "user", content: "اقترح حتى اقتراحين أو لا شيء." }], schema: adaptationAdvisorOutput,
    verify: (o) => verifyAdvisor(o),
  });
  if (r.ok) return { suggestions: r.data.suggestions, source: "ai" };
  return { suggestions: [], source: "fixed" };
}

export function verifyAdvisor(o: AdaptationAdvisorOutput): string | null {
  if (o.suggestions.length > customization.adaptation.max_suggestions_per_run) return "too_many";
  for (const s of o.suggestions) {
    const t = customization.adaptation.allowed_types[s.type];
    if (!t) return "type_not_allowed";
    if ((t.setting_key ?? null) !== (s.setting_key ?? null)) return "setting_key_mismatch";
    if (/تشخيص|اضطراب|مرض/.test(`${s.reason_short} ${s.expected_effect}`)) return "diagnosis_language";
  }
  return null;
}

/** template_drafter (ADAPT-7): نسخة محسّنة لقالب ضعيف إلى طابور المشرف فقط. السقوط = لا مسودة. */
export async function draftTemplate(i: { db: SupabaseClient; caller: ModelCaller; template: MissionTemplate; metrics: Record<string, unknown>; now?: Date }): Promise<{ draft: MissionTemplate; rationale: string } | null> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "template_drafter", profileId: null, now: i.now,
    system: `${personaSystem("adult")}\n\n${FUNCTION_INSTRUCTIONS.template_drafter}`,
    dynamicSystem: `القالب الحالي: ${JSON.stringify(i.template)}\nمقاييسه: ${JSON.stringify(i.metrics)}`,
    messages: [{ role: "user", content: "اكتب نسخة محسّنة كاملة." }],
    schema: templateDrafterOutput,
    verify: (o) => verifyDraft(o, i.template),
  });
  if (!r.ok) return null;
  return { draft: { ...r.data.template, id: i.template.id, version: i.template.version + 1, status: "draft", origin: "ai_draft" }, rationale: r.data.rationale };
}

import { z } from "zod";
export const templateDrafterOutput = z.object({ template: templateSchema, rationale: z.string().min(1).max(600) });
export type TemplateDrafterOutput = z.infer<typeof templateDrafterOutput>;

export function verifyDraft(o: TemplateDrafterOutput, source: MissionTemplate): string | null {
  const t = o.template;
  if (t.id !== source.id) return "id_changed";
  if (t.mechanic !== source.mechanic) return "mechanic_changed";
  if (t.training_level !== source.training_level) return "training_level_changed";
  const srcCaps = Object.keys(source.capability_weights).sort().join(","), caps = Object.keys(t.capability_weights).sort().join(",");
  if (srcCaps !== caps) return "capabilities_changed";
  if (t.strategies.length < source.strategies.length) return "fewer_strategies";
  return null;
}
