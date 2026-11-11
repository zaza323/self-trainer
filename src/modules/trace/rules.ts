/** RULES-7: نص «ليش؟» يُركَّب من قالب ثابت وبيانات أثر القرار. لا ذكاء اصطناعي. */
import content from "@content/decision_trace.ar.json";

export type TraceKind = "support_level" | "incentive_stage" | "time_margin" | "notification_defer";
export const TRACE_KINDS: TraceKind[] = ["support_level", "incentive_stage", "time_margin", "notification_defer"];
export type Trace = { kind: TraceKind; rule: string; decision: Record<string, unknown>; inputs: Record<string, unknown> };

export function traceText(t: Pick<Trace, "rule" | "decision" | "inputs">): string {
  const tpl = (content.rules as Record<string, string>)[t.rule];
  if (!tpl) return content.unknown;
  const vars = { ...t.inputs, ...t.decision } as Record<string, unknown>;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => { const v = vars[k]; return typeof v === "number" ? String(Math.round(v)) : typeof v === "string" ? v : ""; });
}
export const whyLabel = content.button;
