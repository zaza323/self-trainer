"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { effective } from "@/modules/settings";
import { instantForLocal } from "@/modules/notifications/plan";
import { addActualBlock, removeActualBlock, completeReconstruction, saveMirror, saveNoticed, chooseChange } from "./service";
import type { AgeMode } from "@/shared/config";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };
async function owner() { const s = await getSession(); if (!s?.profile || s.profile.kind !== "player") return null; return { id: s.profile.id, age_mode: s.profile.age_mode as AgeMode, timezone: s.profile.timezone }; }

export async function addSegmentAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ reconstruction_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/), category: z.string().min(1).max(40), label: z.string().trim().max(60).optional().or(z.literal("")), energy: z.enum(["high", "normal", "low"]).optional().or(z.literal("")) })
    .safeParse({ reconstruction_id: form.get("reconstruction_id"), date: form.get("date"), from: form.get("from"), to: form.get("to"), category: form.get("category"), label: form.get("label") ?? "", energy: form.get("energy") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const d = p.data;
  const r = await addActualBlock(await createClient(), { reconstructionId: d.reconstruction_id, startsAt: instantForLocal(d.date, d.from, o.timezone).toISOString(), endsAt: instantForLocal(d.date, d.to, o.timezone).toISOString(), category: d.category, label: d.label || null, energy: d.energy || null, origin: "manual" });
  if (!r.ok) return { ok: false, error: r.error ?? "failed" };
  revalidatePath("/app/mirror", "layout");
  return { ok: true };
}
export async function removeSegmentAction(_: unknown, form: FormData): Promise<Res> {
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  if (!(await owner())) return { ok: false, error: "not_allowed" };
  await removeActualBlock(await createClient(), id.data);
  revalidatePath("/app/mirror", "layout");
  return { ok: true };
}
export async function completeReconstructionAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ reconstruction_id: z.string().uuid(), screen_min: z.coerce.number().int().min(0).max(1440).optional().or(z.literal("")), next: z.string().optional() }).safeParse({ reconstruction_id: form.get("reconstruction_id"), screen_min: form.get("screen_min") ?? "", next: form.get("next") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const r = await completeReconstruction(await createClient(), adminOrNull(), o, { reconstructionId: p.data.reconstruction_id, screenEstimateMin: typeof p.data.screen_min === "number" ? p.data.screen_min : null });
  if (!r.ok) return { ok: false, error: "save_failed" };
  revalidatePath("/app/mirror", "layout");
  if (p.data.next === "predict") redirect("/app/mirror/predict");
  return { ok: true, data: r };
}
/** P49: التوقّع ثم إنشاء المرآة (R1). */
export async function predictAndMirrorAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ categories: z.array(z.string().min(1)).min(1).max(3), hours: z.array(z.coerce.number().min(0).max(24)).min(1) }).safeParse({ categories: form.getAll("category"), hours: form.getAll("hours") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const days = (await effective<number>(db, o.id, "mirror_days_required")).value;
  const r = await saveMirror(db, adminOrNull(), o, { days, predictions: p.data.categories.map((c, i) => ({ category: c, predicted_hours: p.data.hours[i] ?? 0 })), now: new Date() });
  if (!r.ok) return { ok: false, error: "no_days" };
  redirect(`/app/mirror/${r.id}`);
}
export async function noticedAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ report_id: z.string().uuid(), text: z.string().trim().min(1).max(1000) }).safeParse({ report_id: form.get("report_id"), text: form.get("text") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  if (!(await owner())) return { ok: false, error: "not_allowed" };
  await saveNoticed(await createClient(), p.data.report_id, p.data.text);
  revalidatePath("/app/mirror", "layout");
  return { ok: true };
}
export async function chooseChangeAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ report_id: z.string().uuid(), text: z.string().trim().min(1).max(300) }).safeParse({ report_id: form.get("report_id"), text: form.get("text") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const r = await chooseChange(await createClient(), adminOrNull(), o, { reportId: p.data.report_id, text: p.data.text });
  revalidatePath("/app/mirror", "layout");
  return r.ok ? { ok: true, data: r } : { ok: false, error: "save_failed" };
}
/** P01b: اختيار المسار عند الانضمام. */
export async function onboardingPathAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ path: z.enum(["reality", "goals"]) }).safeParse({ path: form.get("path") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  await (await createClient()).from("profiles").update({ onboarding_path: p.data.path }).eq("id", o.id);
  redirect(p.data.path === "reality" ? "/app/mirror/reconstruct?date=yesterday&source=onboarding" : "/onboarding/context");
}
