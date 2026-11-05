import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "../prompts";
import { progressNarratorOutput, weeklySummaryOutput, strategyNormalizerOutput } from "../schemas";

/** progress_narrator: السقوط = الجمل الثابتة (buildNarrative) التي يمررها المستدعي. */
export async function narrate(i: { db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode; facts: Record<string, unknown>; fixedLines: string[] }): Promise<{ lines: string[]; highlighted: string | null; source: "ai" | "fixed" }> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "progress_narrator", profileId: i.profileId,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.progress_narrator}`,
    dynamicSystem: `وقائع المهمة: ${JSON.stringify(i.facts)}`,
    messages: [{ role: "user", content: "اكتب السرد." }], schema: progressNarratorOutput,
    verify: (o) => (/\b(XP|نقطة|نقاط)\b/.test(o.narrative) ? "no_points_in_narrative" : null),
  });
  if (r.ok) return { lines: r.data.narrative.split(/\n+/).filter(Boolean), highlighted: r.data.highlighted_capability, source: "ai" };
  return { lines: i.fixedLines, highlighted: null, source: "fixed" };
}

/** weekly_summary (GUARD-4): السقوط = ملخص رقمي بلا نص مولّد. */
export async function weeklySummary(i: { db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode; stats: Record<string, unknown> }): Promise<{ improved: string[]; needs_support: string[]; guardian_tip: string; source: "ai" | "fixed" }> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "weekly_summary", profileId: i.profileId,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.weekly_summary}`,
    dynamicSystem: `أدلة الأسبوع وإحصاءاته: ${JSON.stringify(i.stats)}`,
    messages: [{ role: "user", content: "لخّص الأسبوع للمربي." }], schema: weeklySummaryOutput,
    verify: (o) => (/تشخيص|اضطراب|مرض/.test([o.guardian_tip, ...o.improved, ...o.needs_support].join(" ")) ? "diagnosis_language" : null),
  });
  if (r.ok) return { ...r.data, source: "ai" };
  return { improved: [], needs_support: [], guardian_tip: "", source: "fixed" };
}

/** strategy_normalizer: السقوط = "custom". */
export async function normalizeStrategy(i: { db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode; mechanic: string; strategy: string }): Promise<string> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "strategy_normalizer", profileId: i.profileId,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.strategy_normalizer}`,
    dynamicSystem: `الميكانيكية: ${i.mechanic}`,
    messages: [{ role: "user", content: i.strategy }], schema: strategyNormalizerOutput,
    verify: (o) => (o.label.trim().split(/\s+/).length > 4 ? "label_too_long" : null),
  });
  return r.ok ? r.data.label.trim() : "custom";
}
