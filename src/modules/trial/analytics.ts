import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trial } from "@/shared/config";

/**
 * أحداث منتج مجهّلة (القسم 9): اسم الحدث من قائمة مسموحة، الخصائص من مفاتيح مسموحة وقيم بدائية قصيرة (لا محتوى محادثات/تأملات/سياق حياة)،
 * ومعرّف الملف يُستبدل بـ hash مملّح. تُحفظ في product_events وتُرسل إلى PostHog إن ضُبط POSTHOG_KEY.
 */
export type TrackInput = { event: string; profileId?: string | null; props?: Record<string, unknown> };
export type Sanitized = { event: string; profile_hash: string | null; props: Record<string, string | number | boolean> } | { error: string };

export function profileHash(profileId: string, salt = process.env.ANALYTICS_SALT ?? "self-trainer"): string {
  return createHash("sha256").update(`${salt}:${profileId}`).digest("hex").slice(0, trial.analytics.profile_hash_length);
}

export function sanitizeEvent(i: TrackInput, salt?: string): Sanitized {
  if (!trial.analytics.events.includes(i.event)) return { error: "event_not_allowed" };
  const props: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(i.props ?? {})) {
    if (!trial.analytics.allowed_props.includes(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) props[k] = v;
    else if (typeof v === "boolean") props[k] = v;
    else if (typeof v === "string" && v.length <= trial.analytics.max_string_prop_length && !/\s.*\s.*\s/.test(v)) props[k] = v; // لا جمل
  }
  return { event: i.event, profile_hash: i.profileId ? profileHash(i.profileId, salt) : null, props };
}

export type PostHogSender = (payload: { event: string; distinct_id: string; properties: Record<string, unknown> }) => Promise<void>;
export function postHogSender(): PostHogSender | null {
  const key = process.env.POSTHOG_KEY, host = process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com";
  if (!key) return null;
  return async (p) => { await fetch(`${host}/capture/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key, ...p }) }).catch(() => {}); };
}

/** لا يرمي أبدًا: القياس لا يعطّل المسار. */
export async function track(admin: SupabaseClient, i: TrackInput, sender: PostHogSender | null = postHogSender()): Promise<boolean> {
  const s = sanitizeEvent(i);
  if ("error" in s) return false;
  try {
    await admin.from("product_events").insert({ event: s.event, profile_hash: s.profile_hash, props: s.props });
    if (sender) await sender({ event: s.event, distinct_id: s.profile_hash ?? "anonymous", properties: s.props });
    return true;
  } catch { return false; }
}
