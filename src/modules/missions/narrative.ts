/**
 * شاشة الوعي بالتقدم النصية (5.2 خطوة 7، P10) — السقوط الثابت لـ progress_narrator (7.2).
 * تُركّب من وقائع المهمة فقط، بلا أحكام ولا أرقام نقاط.
 */
import phrases from "@content/progress_phrases.ar.json";
import { textByMode, type MissionTemplate } from "@/modules/library";
import { limits, type AgeMode } from "@/shared/config";

export type MissionFacts = {
  status: "completed" | "abandoned" | "reflected" | "transferred";
  gate1: boolean | null;
  strategy_chosen: string | null;
  custom_strategy: string | null;
  prediction: { minutes?: number; count?: number } | null;
  actual_duration_min: number | null;
  hints_used: number;
  distraction_log: Array<{ at: string; choice: "ignore" | "break_return" | "give_in" }>;
  interrupted: boolean;
};

const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

export function buildNarrative(facts: MissionFacts, template: MissionTemplate, mode: AgeMode): string[] {
  const out: string[] = [];
  const outcome = facts.gate1 === false ? "abandoned" : "completed";
  out.push(phrases.opening[outcome][mode]);

  if (facts.custom_strategy) out.push(fmt(phrases.strategy.custom, { strategy: facts.custom_strategy }));
  else if (facts.strategy_chosen) {
    const s = template.strategies.find((x) => x.id === facts.strategy_chosen);
    if (s) out.push(fmt(phrases.strategy.template, { strategy: textByMode(s.text, mode) }));
  }

  if (facts.prediction?.minutes && facts.actual_duration_min) {
    const predicted = facts.prediction.minutes;
    const actual = facts.actual_duration_min;
    const rel = Math.abs(actual - predicted) / predicted;
    const key = rel <= limits.narrative.accurate_max_relative_error ? "accurate" : actual > predicted ? "under" : "over";
    out.push(fmt(phrases.prediction[key], { predicted, actual }));
  }

  if (facts.interrupted) out.push(outcome === "completed" ? phrases.recovery.resumed : phrases.recovery.interrupted_then_abandoned);

  const n = facts.distraction_log.length;
  if (n > 0) {
    const c = { ignore: 0, break_return: 0, give_in: 0 };
    for (const d of facts.distraction_log) c[d.choice]++;
    if (c.ignore === n) out.push(fmt(phrases.distraction.all_ignored, { count: n }));
    else if (c.give_in === n) out.push(phrases.distraction.all_gave_in);
    else out.push(fmt(phrases.distraction.mixed, { count: n, ...c }));
  }

  if (facts.hints_used === 0) out.push(phrases.hints.none);
  else if (facts.hints_used === 1) out.push(phrases.hints.one);
  else out.push(fmt(phrases.hints.many, { count: facts.hints_used }));

  out.push(phrases.closing[mode]);
  return out;
}

/** MIS-8: استراتيجيات بديلة ونتائجها المحتملة بعد التنفيذ، لا "الإجابة الصحيحة". */
export function alternatives(template: MissionTemplate, chosenId: string | null, mode: AgeMode) {
  return template.strategies.filter((s) => s.id !== chosenId && s.outcome_hint).map((s) => ({ text: textByMode(s.text, mode), hint: s.outcome_hint! }));
}
