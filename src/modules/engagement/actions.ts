"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { startDnd, endDnd, addRetroCompletion, classifyReturn } from "./service";
import type { AgeMode } from "@/shared/config";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
async function owner() { const s = await getSession(); if (!s?.profile || s.profile.kind !== "player") return null; return { id: s.profile.id, age_mode: s.profile.age_mode as AgeMode, timezone: s.profile.timezone }; }

export async function dndAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ kind: z.enum(["1h", "2h", "until_task", "until_tomorrow", "end"]) }).safeParse({ kind: form.get("kind") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  if (p.data.kind === "end") await endDnd(db, o.id); else await startDnd(db, o.id, p.data.kind, o.timezone);
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** P45 سجّل إنجاز (بلا XP وبلا أدلة) ثم تصنيف الغياب (و.3). */
export async function retroCompletionAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ title: z.string().trim().min(1).max(200), approx_at: z.string().min(10), absence_hours: z.coerce.number().min(0).optional(), scheduled: z.coerce.number().int().min(0).default(0), done: z.coerce.number().int().min(0).default(0) })
    .safeParse({ title: form.get("title"), approx_at: form.get("approx_at"), absence_hours: form.get("absence_hours") || undefined, scheduled: form.get("scheduled") ?? 0, done: form.get("done") ?? 0 });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const at = new Date(p.data.approx_at); if (Number.isNaN(at.getTime())) return { ok: false, error: "invalid_input" };
  const r = await addRetroCompletion(db, o.id, { title: p.data.title, approxAt: at.toISOString() });
  if (!r.ok) return { ok: false, error: "save_failed" };
  let classification: string | null = null;
  if (p.data.absence_hours !== undefined) { try { classification = await classifyReturn(createAdminClient(), o, { absenceHours: p.data.absence_hours, scheduledCount: p.data.scheduled, doneCount: p.data.done }); } catch { classification = null; } }
  revalidatePath("/app", "layout");
  return { ok: true, data: { classification } };
}

export async function classifyReturnAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ absence_hours: z.coerce.number().min(0), scheduled: z.coerce.number().int().min(0), done: z.coerce.number().int().min(0) }).safeParse({ absence_hours: form.get("absence_hours"), scheduled: form.get("scheduled"), done: form.get("done") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  try { const c = await classifyReturn(createAdminClient(), o, { absenceHours: p.data.absence_hours, scheduledCount: p.data.scheduled, doneCount: p.data.done }); revalidatePath("/app", "layout"); return { ok: true, data: { classification: c } }; } catch { return { ok: true, data: { classification: null } }; }
}

export async function deleteBusyWindowAction(_: unknown, form: FormData): Promise<Res> {
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  await (await createClient()).from("busy_windows").delete().eq("id", id.data);
  revalidatePath("/app/settings");
  return { ok: true };
}
