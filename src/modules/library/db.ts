import type { SupabaseClient } from "@supabase/supabase-js";
import type { MissionTemplate } from "./schema";

/** صف mission_templates كما يعود من قاعدة البيانات → MissionTemplate. */
export function rowToTemplate(row: Record<string, unknown>, caps: Array<{ capability_id: string; weight: number | string }>): MissionTemplate {
  return {
    id: row.id as string,
    version: row.version as number,
    mechanic: row.mechanic_id as MissionTemplate["mechanic"],
    training_level: row.training_level as MissionTemplate["training_level"],
    difficulty: row.difficulty as number,
    age_modes: row.age_modes as MissionTemplate["age_modes"],
    capability_weights: Object.fromEntries(caps.map((c) => [c.capability_id, Number(c.weight)])) as MissionTemplate["capability_weights"],
    title: row.title_by_mode as MissionTemplate["title"],
    situation: row.situation_by_mode as MissionTemplate["situation"],
    variable_defaults: (row.variable_defaults ?? {}) as MissionTemplate["variable_defaults"],
    strategies: row.strategies as MissionTemplate["strategies"],
    prediction_prompt: (row.prediction_prompt ?? null) as MissionTemplate["prediction_prompt"],
    reflection_prompts: row.reflection_prompts as MissionTemplate["reflection_prompts"],
    hints_by_level: (row.hints_by_level ?? {}) as MissionTemplate["hints_by_level"],
    evidence_rules: row.evidence_rules as MissionTemplate["evidence_rules"],
    completion_check: row.completion_check as MissionTemplate["completion_check"],
    checklist: (row.checklist ?? null) as MissionTemplate["checklist"],
    min_duration: row.min_duration as number,
    max_duration: row.max_duration as number,
    distraction_config: (row.distraction_config ?? null) as MissionTemplate["distraction_config"],
    status: row.status as MissionTemplate["status"],
    origin: row.origin as MissionTemplate["origin"],
  };
}

/** كل القوالب النشطة (آخر إصدار لكل id). */
export async function loadActiveTemplates(db: SupabaseClient): Promise<MissionTemplate[]> {
  const [{ data: rows, error }, { data: caps, error: e2 }] = await Promise.all([
    db.from("mission_templates").select("*").eq("status", "active"),
    db.from("template_capabilities").select("template_id, template_version, capability_id, weight"),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of (rows ?? []) as Record<string, unknown>[]) {
    const prev = latest.get(r.id as string);
    if (!prev || (r.version as number) > (prev.version as number)) latest.set(r.id as string, r);
  }
  return [...latest.values()].map((r) =>
    rowToTemplate(r, ((caps ?? []) as Array<{ template_id: string; template_version: number; capability_id: string; weight: number }>).filter((c) => c.template_id === r.id && c.template_version === r.version)),
  );
}

export async function loadTemplate(db: SupabaseClient, id: string, version: number): Promise<MissionTemplate | null> {
  const [{ data: row }, { data: caps }] = await Promise.all([
    db.from("mission_templates").select("*").eq("id", id).eq("version", version).maybeSingle(),
    db.from("template_capabilities").select("capability_id, weight").eq("template_id", id).eq("template_version", version),
  ]);
  if (!row) return null;
  return rowToTemplate(row as Record<string, unknown>, (caps ?? []) as Array<{ capability_id: string; weight: number }>);
}
