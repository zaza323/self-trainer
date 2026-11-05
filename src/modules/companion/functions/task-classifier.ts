import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "../prompts";
import { taskClassifierOutput, type TaskClassifierOutput } from "../schemas";
import mechanics from "@content/mechanics.ar.json";

export function verifyClassifier(out: TaskClassifierOutput, goalIds: string[]): string | null {
  const sum = Object.values(out.capability_weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.05) return "weights_must_sum_to_1";
  const primary = (mechanics as Record<string, { primary_capability?: string }>)[out.mechanic]?.primary_capability;
  const top = Object.entries(out.capability_weights).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (primary && top !== primary) return "primary_capability_mismatch";
  if (out.suggested_goal_id && !goalIds.includes(out.suggested_goal_id)) return "unknown_goal";
  return null;
}

/** MIS-2 (تُستخدم في المرحلة 5): السقوط = null → الواجهة تطلب اختيار الميكانيكية يدويًا. */
export async function classifyTask(i: { db: SupabaseClient; caller: ModelCaller; profileId: string; mode: AgeMode; text: string; goals: Array<{ id: string; title: string }> }): Promise<TaskClassifierOutput | null> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "task_classifier", profileId: i.profileId,
    system: `${personaSystem(i.mode)}\n\n${FUNCTION_INSTRUCTIONS.task_classifier}`,
    dynamicSystem: `الغايات المتاحة: ${i.goals.map((g) => `${g.id}: ${g.title}`).join(" | ") || "—"}`,
    messages: [{ role: "user", content: i.text }], schema: taskClassifierOutput,
    verify: (o) => verifyClassifier(o, i.goals.map((g) => g.id)),
  });
  return r.ok ? r.data : null;
}
