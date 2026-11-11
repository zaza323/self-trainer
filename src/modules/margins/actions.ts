"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { margins } from "@/shared/config";
import { setTaskMargin, extendMargin, updateRule } from "./service";

export type MarginActionResult = { ok: true; margin_min?: number; applied?: boolean } | { ok: false; error: string };
const uuid = z.string().uuid();
const subject = z.enum(["mission", "planner_task"]);
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };

/** ب.8: الضبط الوحيد للهامش من الواجهة. الصلاحية والنطاق والقفل والحدود تُفحص في القاعدة بهوية الجلسة. */
export async function setTaskMarginAction(_: unknown, form: FormData): Promise<MarginActionResult> {
  const p = z.object({
    subject_type: subject, subject_id: uuid, minutes: z.coerce.number().int().positive(),
    apply_scope: z.enum(margins.apply_scopes as [string, ...string[]]).default("this_task"),
    reason: z.enum(margins.reason_codes as [string, ...string[]]).optional().or(z.literal("")), lock: z.string().optional(),
  }).safeParse({ subject_type: form.get("subject_type"), subject_id: form.get("subject_id"), minutes: form.get("minutes"), apply_scope: form.get("apply_scope") ?? "this_task", reason: form.get("reason") ?? "", lock: form.get("lock") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "unavailable" };
  const r = await setTaskMargin(admin, { actorId: s.userId, type: p.data.subject_type, id: p.data.subject_id, minutes: p.data.minutes, applyScope: p.data.apply_scope as "this_task" | "all_similar", reason: p.data.reason || null, lock: p.data.lock === "on" }, new Date());
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true, margin_min: r.margin_min, applied: r.applied };
}

/** ب.6: «تحتاج وقتًا أكثر؟» — معلومة تُسجَّل، بلا أي أثر على النقاط أو الأدلة. */
export async function extendMarginAction(_: unknown, form: FormData): Promise<MarginActionResult> {
  const p = z.object({ subject_type: subject, subject_id: uuid, minutes: z.coerce.number().int().positive() }).safeParse({ subject_type: form.get("subject_type"), subject_id: form.get("subject_id"), minutes: form.get("minutes") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "unavailable" };
  const r = await extendMargin(admin, { actorId: s.userId, type: p.data.subject_type, id: p.data.subject_id, minutes: p.data.minutes });
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true };
}

/** G18: تعديل قاعدة صريحة أو إيقافها. */
export async function updateMarginRuleAction(_: unknown, form: FormData): Promise<MarginActionResult> {
  const p = z.object({ rule_id: uuid, minutes: z.coerce.number().int().positive().optional().or(z.literal("")), stop: z.string().optional() }).safeParse({ rule_id: form.get("rule_id"), minutes: form.get("minutes") ?? "", stop: form.get("stop") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "unavailable" };
  const r = await updateRule(admin, { actorId: s.userId, ruleId: p.data.rule_id, minutes: typeof p.data.minutes === "number" ? p.data.minutes : null, active: p.data.stop ? false : null });
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true };
}
