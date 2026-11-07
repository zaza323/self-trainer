"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { anthropicCaller } from "@/modules/companion";
import { saveMuhasabaStep, reasonTurn } from "./service";
import type { AgeMode } from "@/shared/config";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };
async function owner() { const s = await getSession(); if (!s?.profile || s.profile.kind !== "player") return null; return { id: s.profile.id, user_id: s.userId, age_mode: s.profile.age_mode as AgeMode, timezone: s.profile.timezone }; }

export async function muhasabaStepAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ entry_id: z.string().uuid(), step: z.enum(["achieved", "shortfall", "next", "did_well", "do_better_tomorrow"]), achieved: z.array(z.string().trim().max(200)).default([]), sf_text: z.array(z.string().trim().max(200)).default([]), sf_reason: z.array(z.string().trim().max(300)).default([]), sf_task: z.array(z.string().max(40)).default([]), next_text: z.array(z.string().trim().max(200)).default([]), next_task: z.array(z.string().max(40)).default([]) })
    .safeParse({ entry_id: form.get("entry_id"), step: form.get("step"), achieved: form.getAll("achieved"), sf_text: form.getAll("sf_text"), sf_reason: form.getAll("sf_reason"), sf_task: form.getAll("sf_task"), next_text: form.getAll("next_text"), next_task: form.getAll("next_task") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const d = p.data;
  const shortfalls = d.sf_text.map((text, i) => ({ text, reason: d.sf_reason[i] || null, task_id: d.sf_task[i] && /^[0-9a-f-]{36}$/.test(d.sf_task[i]!) ? d.sf_task[i]! : null })).filter((x) => x.text);
  const nextSteps = d.next_text.map((text, i) => ({ text, task_id: d.next_task[i] && /^[0-9a-f-]{36}$/.test(d.next_task[i]!) ? d.next_task[i]! : null })).filter((x) => x.text);
  const r = await saveMuhasabaStep(await createClient(), adminOrNull(), o, { entryId: d.entry_id, step: d.step, achieved: d.achieved.filter(Boolean).map((text) => ({ text, source: "user" })), shortfalls, nextSteps });
  if (!r.ok) return { ok: false, error: r.error ?? "failed" };
  revalidatePath("/app", "layout");
  return { ok: true, data: r };
}

/** سبب التقصير ⇒ رد المرافق (أو السقوط الثابت) + M1. */
export async function muhasabaReasonAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ entry_id: z.string().uuid(), shortfall: z.string().trim().max(200).optional().or(z.literal("")), reason: z.string().trim().min(1).max(300) }).safeParse({ entry_id: form.get("entry_id"), shortfall: form.get("shortfall") ?? "", reason: form.get("reason") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const admin = adminOrNull();
  if (!admin) { const { reframeLine } = await import("./flow"); return { ok: true, data: { reply: reframeLine(o.age_mode, p.data.shortfall || null), source: "fixed" } }; }
  const r = await reasonTurn(admin, anthropicCaller(), o, { shortfallText: p.data.shortfall || null, reasonText: p.data.reason, dedupeKey: `${p.data.entry_id}:${p.data.shortfall || "x"}` });
  return { ok: true, data: r };
}
