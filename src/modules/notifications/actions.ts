"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { getSession } from "@/modules/accounts";

export type NotifActionResult = { ok: true } | { ok: false; error: string };

const subSchema = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) });

/** NOTIF-4: حفظ اشتراك Web Push لهذا الجهاز (المتدرب أو المربي). */
export async function savePushSubscription(sub: unknown, userAgent?: string): Promise<NotifActionResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const p = subSchema.safeParse(sub);
  if (!p.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { error } = await db.from("push_subscriptions").upsert({ user_id: s.userId, endpoint: p.data.endpoint, p256dh: p.data.keys.p256dh, auth: p.data.keys.auth, user_agent: userAgent?.slice(0, 200) ?? null, last_seen_at: new Date().toISOString(), failed_at: null }, { onConflict: "endpoint" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<NotifActionResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", s.userId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function markNotificationRead(_: unknown, form: FormData): Promise<NotifActionResult> {
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { error } = await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/notifications"); revalidatePath("/guardian/notifications");
  return { ok: true };
}

/** NOTIF-4: المنطقة الزمنية من الجهاز (الحالات الحدية: حدود اليوم بالمنطقة الزمنية وقت الحدث). */
export async function updateTimezone(tz: string): Promise<NotifActionResult> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "not_allowed" };
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { return { ok: false, error: "invalid_timezone" }; }
  const db = await createClient();
  const { error } = await db.from("profiles").update({ timezone: tz }).eq("id", s.profile.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
