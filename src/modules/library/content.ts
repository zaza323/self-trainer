/**
 * تحميل القوالب من content/templates (Node فقط: scripts والاختبارات). التطبيق يقرأ من قاعدة البيانات.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { templateSchema, type MissionTemplate } from "./schema";

export function templatesDir() {
  return path.resolve(process.cwd(), "content/templates");
}

export function loadTemplatesFromContent(dir = templatesDir()): MissionTemplate[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => {
    const raw = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    delete raw._review;
    const parsed = templateSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`template ${f}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    if (parsed.data.id !== f.replace(/\.json$/, "")) throw new Error(`template ${f}: id mismatch`);
    return parsed.data;
  });
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const jsonLit = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

/** SQL مُعاد التشغيل لمزامنة القوالب إلى mission_templates/template_capabilities (LIB-1/LIB-3: الإصدار مفتاح). */
export function buildTemplatesSyncSql(templates: MissionTemplate[]): string {
  const lines: string[] = [];
  for (const t of templates) {
    lines.push(`insert into public.mission_templates (id, version, mechanic_id, training_level, difficulty, age_modes, title_by_mode, situation_by_mode, variable_defaults, strategies, prediction_prompt, reflection_prompts, hints_by_level, evidence_rules, completion_check, checklist, min_duration, max_duration, distraction_config, status, origin)
values (${lit(t.id)}, ${t.version}, ${lit(t.mechanic)}, ${lit(t.training_level)}, ${t.difficulty}, array[${t.age_modes.map(lit).join(",")}]::public.age_mode[],
  ${jsonLit(t.title)}, ${jsonLit(t.situation)}, ${jsonLit(t.variable_defaults)}, ${jsonLit(t.strategies)}, ${t.prediction_prompt ? jsonLit(t.prediction_prompt) : "null"},
  ${jsonLit(t.reflection_prompts)}, ${jsonLit(t.hints_by_level)}, ${jsonLit(t.evidence_rules)}, ${lit(t.completion_check)}, ${t.checklist ? jsonLit(t.checklist) : "null"},
  ${t.min_duration}, ${t.max_duration}, ${t.distraction_config ? jsonLit(t.distraction_config) : "null"}, ${lit(t.status)}, ${lit(t.origin)})
on conflict (id, version) do update set mechanic_id = excluded.mechanic_id, training_level = excluded.training_level, difficulty = excluded.difficulty,
  age_modes = excluded.age_modes, title_by_mode = excluded.title_by_mode, situation_by_mode = excluded.situation_by_mode, variable_defaults = excluded.variable_defaults,
  strategies = excluded.strategies, prediction_prompt = excluded.prediction_prompt, reflection_prompts = excluded.reflection_prompts, hints_by_level = excluded.hints_by_level,
  evidence_rules = excluded.evidence_rules, completion_check = excluded.completion_check, checklist = excluded.checklist, min_duration = excluded.min_duration,
  max_duration = excluded.max_duration, distraction_config = excluded.distraction_config, status = excluded.status, origin = excluded.origin;`);
    lines.push(`delete from public.template_capabilities where template_id = ${lit(t.id)} and template_version = ${t.version};`);
    for (const [cap, w] of Object.entries(t.capability_weights)) {
      lines.push(`insert into public.template_capabilities (template_id, template_version, capability_id, weight) values (${lit(t.id)}, ${t.version}, ${lit(cap)}, ${w});`);
    }
  }
  return lines.join("\n");
}
