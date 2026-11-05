"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { getSession } from "@/modules/accounts";
import { addContextItem, emptyContext, CONTEXT_FIELDS, type ContextField, type PersonalContext } from "./personal-context";

export type ContextActionResult = { ok: true } | { ok: false; error: string };
const uuid = z.string().uuid();

async function load(db: Awaited<ReturnType<typeof createClient>>, profileId: string): Promise<PersonalContext> {
  const { data } = await db.from("personal_context").select("interests, routine, free_windows, contexts").eq("profile_id", profileId).maybeSingle();
  return data ? { interests: (data.interests as string[]) ?? [], routine: (data.routine as string[]) ?? [], free_windows: (data.free_windows as string[]) ?? [], contexts: (data.contexts as string[]) ?? [] } : emptyContext();
}

/** ADAPT-1 / P03 / G12: إضافة عنصر إلى حقل (المتدرب، أو المربي في child بصلاحية manage_settings). لا يُحفظ شيء ضمنيًا. */
export async function addContext(_: unknown, form: FormData): Promise<ContextActionResult> {
  const p = z.object({ profile_id: uuid, field: z.enum(CONTEXT_FIELDS as [ContextField, ...ContextField[]]), value: z.string().max(200) }).safeParse({ profile_id: form.get("profile_id"), field: form.get("field"), value: form.get("value") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const r = addContextItem(await load(db, p.data.profile_id), p.data.field, p.data.value);
  if (!r.ok) return { ok: false, error: r.reason };
  const { error } = await db.from("personal_context").upsert({ profile_id: p.data.profile_id, ...r.pc, updated_by: s.userId, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
  if (error) return { ok: false, error: /row-level security/.test(error.message) ? "not_allowed" : error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeContext(_: unknown, form: FormData): Promise<ContextActionResult> {
  const p = z.object({ profile_id: uuid, field: z.enum(CONTEXT_FIELDS as [ContextField, ...ContextField[]]), value: z.string() }).safeParse({ profile_id: form.get("profile_id"), field: form.get("field"), value: form.get("value") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const pc = await load(db, p.data.profile_id);
  const next = { ...pc, [p.data.field]: pc[p.data.field].filter((x) => x !== p.data.value) };
  const { error } = await db.from("personal_context").upsert({ profile_id: p.data.profile_id, ...next, updated_by: s.userId, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
  if (error) return { ok: false, error: "not_allowed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** ADAPT-2: قبول/رفض اقتراح المرافق لإضافة إلى سياق الحياة. القبول يمر عبر التحقق نفسه. */
export async function decideContextSuggestion(_: unknown, form: FormData): Promise<ContextActionResult> {
  const p = z.object({ suggestion_id: uuid, decision: z.enum(["accepted", "rejected"]) }).safeParse({ suggestion_id: form.get("suggestion_id"), decision: form.get("decision") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data: sug } = await db.from("context_suggestions").select("id, profile_id, field, value, status").eq("id", p.data.suggestion_id).maybeSingle();
  if (!sug || sug.status !== "pending") return { ok: false, error: "not_found" };
  if (p.data.decision === "accepted") {
    const r = addContextItem(await load(db, sug.profile_id as string), sug.field as ContextField, sug.value as string);
    if (!r.ok) return { ok: false, error: r.reason };
    const { error } = await db.from("personal_context").upsert({ profile_id: sug.profile_id, ...r.pc, updated_by: s.userId, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
    if (error) return { ok: false, error: "not_allowed" };
  }
  await db.from("context_suggestions").update({ status: p.data.decision }).eq("id", sug.id);
  revalidatePath("/", "layout");
  return { ok: true };
}
