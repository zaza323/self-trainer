"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { getSession } from "@/modules/accounts";
import { createAdminClient } from "@/shared/db/admin";
import { track } from "@/modules/trial";

export type SuggestionActionResult = { ok: true; data?: unknown } | { ok: false; error: string };

/** 5.8 خطوة 3–4: "طبّق" أو "لا الآن". القبول يمر عبر نظام الإعدادات في RPC بمصدر تدقيق adaptation_suggestion. */
export async function decideSuggestion(_: unknown, form: FormData): Promise<SuggestionActionResult> {
  const p = z.object({ id: z.string().uuid(), decision: z.enum(["accepted", "rejected"]) }).safeParse({ id: form.get("id"), decision: form.get("decision") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data, error } = await db.rpc("decide_adaptation_suggestion", { p_id: p.data.id, p_decision: p.data.decision });
  if (error) return { ok: false, error: /not allowed/.test(error.message) ? "not_allowed" : /already decided/.test(error.message) ? "already_decided" : error.message };
  try { await track(createAdminClient(), { event: "suggestion_decided", profileId: s.profile?.id ?? null, props: { decision: p.data.decision } }); } catch { /* بلا مفتاح خدمة */ }
  revalidatePath("/app", "layout"); revalidatePath("/guardian", "layout");
  return { ok: true, data };
}

/** ADMIN-5: قبول/رفض مسودة قالب من الذكاء الاصطناعي. */
export async function reviewTemplateDraft(_: unknown, form: FormData): Promise<SuggestionActionResult> {
  const p = z.object({ template_id: z.string().min(1), version: z.coerce.number().int().positive(), decision: z.enum(["approved", "rejected"]), notes: z.string().max(500).optional() }).safeParse({ template_id: form.get("template_id"), version: form.get("version"), decision: form.get("decision"), notes: form.get("notes") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.isAdmin) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { error } = await db.rpc("review_template_draft", { p_template_id: p.data.template_id, p_version: p.data.version, p_decision: p.data.decision, p_notes: p.data.notes ?? null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin", "layout");
  return { ok: true };
}
