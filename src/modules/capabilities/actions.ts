"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { getSession } from "@/modules/accounts";

/** MAP-2: المستخدم يعدّل "ماذا تعلمت عن نفسك" بكلماته. MAP-4: جواب سؤال الانخفاض يُلحق بالنص. */
export async function saveSelfInsights(_: unknown, form: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = z.object({ text: z.string().trim().max(2000), decline_answer: z.string().trim().max(500).optional().or(z.literal("")) }).safeParse({ text: form.get("text") ?? "", decline_answer: form.get("decline_answer") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return { ok: false, error: "not_allowed" };
  const text = p.data.decline_answer ? `${p.data.text}\n${p.data.decline_answer}`.trim() : p.data.text;
  const db = await createClient();
  const { error } = await db.from("self_insights").upsert({ profile_id: s.profile.id, text, edited_by_user: true, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
  if (error) return { ok: false, error: /row-level security/.test(error.message) ? "not_allowed" : error.message };
  revalidatePath("/app/map");
  return { ok: true };
}
