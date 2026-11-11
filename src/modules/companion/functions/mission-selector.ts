import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import { textByMode, type MissionTemplate } from "@/modules/library";
import type { Suggestion } from "@/modules/engine";
import { acceptRef, type ScenarioSource } from "@/modules/lifelog/rules";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "../prompts";
import { missionSelectorOutput, type MissionSelectorOutput } from "../schemas";

export type SelectorInput = {
  db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode;
  candidates: Suggestion[];           // يبنيها الخادم (ENGINE-2)؛ الأول هو الأعلى بالقواعد
  /** 0.5 أ.5: مصادر السيناريو المؤكَّدة لهذا المستخدم فقط (مهام مخططه وعناصر سجله)؛ لا يُرسل غيرها من السجل */
  sources: ScenarioSource[];
  goalTitle: string | null;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 7.3: template_id من المرشحين فقط؛ الصعوبة والوقت يُقصان ضمن حدود القالب في الخادم.
 * 0.5 أ.5: النموذج لا يكتب سياقًا ولا موقفًا؛ يقترح ref فقط، ويُقبل إن كان ضمن مصادر المستخدم التي أعطاها الخادم (وإلا يُهمل).
 */
export function applySelectorRules(out: MissionSelectorOutput, candidates: Suggestion[], sources: ScenarioSource[] = []): Suggestion | null {
  const c = candidates.find((x) => x.template.id === out.template_id);
  if (!c) return null;
  const t: MissionTemplate = c.template;
  const difficulty = clamp(out.difficulty, Math.max(1, c.difficulty - 1), Math.min(5, c.difficulty + 1));
  const timeBudget: string | number = out.variables.time_budget !== undefined ? clamp(out.variables.time_budget, t.min_duration, t.max_duration) : (c.variables.time_budget ?? t.min_duration);
  const src = t.life_binding !== "none" ? acceptRef(out.ref, sources) : null;
  return { ...c, difficulty, variables: { ...c.variables, time_budget: timeBudget }, rationale: out.rationale, ...(src ? { life_source: src } : {}) };
}

export async function selectWithAi(i: SelectorInput): Promise<{ suggestion: Suggestion; source: "ai" | "rules" }> {
  const top = i.candidates[0];
  if (!top) throw new Error("no candidates");
  const list = i.candidates.map((c, k) => `${k + 1}. ${c.template.id} — ${textByMode(c.template.title, i.mode)} (${c.template.mechanic}, ${c.template.training_level}, صعوبة ${c.difficulty}, ${c.template.min_duration}–${c.template.max_duration} دقيقة) سبب القواعد: ${c.rationale}`).join("\n");
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "mission_selector", profileId: i.profileId,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.mission_selector}`,
    dynamicSystem: `المرشحون (اختر منهم فقط):\n${list}\nالغاية النشطة: ${i.goalTitle ?? "—"}\nالمصادر (لقوالب الحياة فقط): ${JSON.stringify(i.sources.map((x) => ({ ref_type: x.ref_type, ref_id: x.ref_id, text: x.text })))}`,
    messages: [{ role: "user", content: "اختر المهمة الأنسب لليوم واملأ متغيراتها." }],
    schema: missionSelectorOutput,
    verify: (o) => (i.candidates.some((c) => c.template.id === o.template_id) ? null : "template_not_in_candidates"),
  });
  if (r.ok) { const s = applySelectorRules(r.data, i.candidates, i.sources); if (s) return { suggestion: s, source: "ai" }; }
  return { suggestion: top, source: "rules" };
}
