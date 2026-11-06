import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limits, planner, type AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { decideDelivery, localParts, nextDailySlot, resolveMaxPerDay, type TimeRange } from "./plan";
import { renderNotification, urlForNotification, containsForbidden, type Audience } from "./texts";
import type { PushSender } from "./sender";
import capabilities from "@content/capabilities.ar.json";

type Profile = { id: string; user_id: string; age_mode: AgeMode | null; timezone: string; display_name: string; kind: string };
type NotifRow = { id: string; profile_id: string; type: string; scheduled_for: string; payload: Record<string, unknown>; deferred_count: number };

async function playerSettings(db: SupabaseClient, profileId: string, ageMode: AgeMode) {
  const [time, max, quiet, brk] = await Promise.all([
    effective<string>(db, profileId, "notification_time"),
    effective<number | "auto">(db, profileId, "notification_max_per_day"),
    effective<TimeRange>(db, profileId, "quiet_hours"),
    effective<boolean>(db, profileId, "break_mode"),
  ]);
  return { notificationTime: time.value, maxPerDay: resolveMaxPerDay(max.value, planner.engagement.budget.low[ageMode] as number, limits.notifications.hard_cap_per_day), quiet: quiet.value ?? null, breakMode: brk.value };
}

/**
 * المخطط اليومي (NOTIF-2): لكل متدرب نشط: "مهمة اليوم"، "عودة بعد انقطاع"، "فحص دوري" — في وقت الإشعار المختار،
 * بمفتاح تكرار (dedupe_key) فلا يُنشأ الإشعار نفسه مرتين. وضع الاستراحة يوقف الاقتراحات والإشعارات (5.5).
 */
export async function planForProfile(admin: SupabaseClient, p: Profile, now = new Date()): Promise<number> {
  if (p.kind !== "player" || !p.age_mode) return 0;
  const s = await playerSettings(admin, p.id, p.age_mode);
  if (s.breakMode) return 0;
  const slot = nextDailySlot(now, p.timezone, s.notificationTime);
  if (slot.getTime() - now.getTime() > limits.notifications.planner_lookahead_hours * 3600000) return 0;
  const slotDate = localParts(slot, p.timezone).date;
  const rows: Array<{ type: string; dedupe_key: string; payload: Record<string, unknown>; scheduled_for: string }> = [];

  // 1) مهمة اليوم: إن وُجدت مهمة مفتوحة أو مقترحة لليوم المحلي للفتحة
  const { data: open } = await admin.from("missions").select("id").eq("profile_id", p.id).in("status", ["suggested", "chosen", "planned"]).eq("dismissed", false).limit(1);
  if (open?.length) rows.push({ type: "mission_today", dedupe_key: `mission_today:${p.id}:${slotDate}`, payload: {}, scheduled_for: slot.toISOString() });

  // 2) العودة بعد انقطاع (5.5): آخر انتقال أقدم من N أيام، ولا تكرار خلال repeat_days
  const { data: mids } = await admin.from("missions").select("id").eq("profile_id", p.id);
  const ids = ((mids ?? []) as Array<{ id: string }>).map((m) => m.id);
  const { data: lastTr } = ids.length ? await admin.from("mission_transitions").select("at").in("mission_id", ids).order("at", { ascending: false }).limit(1) : { data: [] };
  const lastAt = ((lastTr ?? [])[0] as { at?: string } | undefined)?.at;
  if (lastAt && (now.getTime() - Date.parse(lastAt)) / 86400000 >= limits.notifications.comeback_after_gap_days) {
    const since = new Date(now.getTime() - limits.notifications.comeback_repeat_days * 86400000).toISOString();
    const { data: recent } = await admin.from("notifications").select("id").eq("profile_id", p.id).eq("type", "comeback").gte("created_at", since).limit(1);
    if (!recent?.length) rows.push({ type: "comeback", dedupe_key: `comeback:${p.id}:${slotDate}`, payload: {}, scheduled_for: slot.toISOString() });
  }

  // 3) الفحص الدوري للمتقن (5.4): موعده خلال lead_days
  const horizon = new Date(now.getTime() + limits.notifications.mastery_check_lead_days * 86400000);
  const { data: checks } = await admin.from("capability_states").select("capability_id, next_mastery_check_at").eq("profile_id", p.id).eq("training_level", "mastered").lte("next_mastery_check_at", localParts(horizon, p.timezone).date);
  for (const c of (checks ?? []) as Array<{ capability_id: string; next_mastery_check_at: string | null }>) {
    if (!c.next_mastery_check_at) continue;
    rows.push({ type: "mastery_check", dedupe_key: `mastery_check:${p.id}:${c.capability_id}:${c.next_mastery_check_at}`, payload: { capability_id: c.capability_id }, scheduled_for: slot.toISOString() });
  }
  if (rows.length === 0) return 0;
  const { data } = await admin.from("notifications").upsert(rows.map((r) => ({ profile_id: p.id, ...r })), { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  return (data as unknown[] | null)?.length ?? 0;
}

const capName = (id: string) => (capabilities as unknown as Record<string, { name: string }>)[id]?.name ?? id;

/** يبني عنوان الإشعار ونصه ورابطه (ومن يستلمه). */
export function buildMessage(n: NotifRow, p: Profile): { audience: Audience; recipientUserId: string | null; title: string; body: string; url: string } | null {
  const guardianId = typeof n.payload.guardian_id === "string" ? n.payload.guardian_id : null;
  const audience: Audience = guardianId ? "guardian" : (p.age_mode ?? "adult");
  const r = renderNotification(n.type, audience, { name: p.display_name, title: typeof n.payload.title === "string" ? n.payload.title : "", capability: typeof n.payload.capability_id === "string" ? capName(n.payload.capability_id) : "" });
  if (!r) return null;
  if (containsForbidden(r.title) || containsForbidden(r.body)) return null; // NOTIF-3 حارس أخير
  return { audience, recipientUserId: guardianId ?? p.user_id, title: r.title, body: r.body, url: urlForNotification(n.type, { ...n.payload, profile_id: p.id }, audience) };
}

/**
 * التسليم (NOTIF-1، NOTIF-4، NOTIF-5): لكل إشعار مستحق: الحد اليومي وساعات الهدوء بالمنطقة الزمنية (الأمان يتجاوزهما)،
 * ثم Web Push لكل أجهزة المستلم؛ الاشتراكات الميتة تُحذف. يُعلَّم sent_at دائمًا (الإشعار يبقى في الصندوق داخل التطبيق).
 */
export async function deliverDue(admin: SupabaseClient, sender: PushSender, now = new Date()): Promise<{ sent: number; deferred: number; pushed: number; dropped: number }> {
  const { data: due } = await admin.from("notifications").select("id, profile_id, type, scheduled_for, payload, deferred_count").is("sent_at", null).lte("scheduled_for", now.toISOString()).order("scheduled_for", { ascending: true }).limit(500);
  const rows = (due ?? []) as NotifRow[];
  if (rows.length === 0) return { sent: 0, deferred: 0, pushed: 0, dropped: 0 };
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const { data: profs } = await admin.from("profiles").select("id, user_id, age_mode, timezone, display_name, kind").in("id", profileIds);
  const profiles = new Map(((profs ?? []) as Profile[]).map((p) => [p.id, p]));
  const settingsCache = new Map<string, Awaited<ReturnType<typeof playerSettings>>>();
  const sentToday = new Map<string, number>();
  let sent = 0, deferred = 0, pushed = 0, dropped = 0;
  for (const n of rows) {
    const p = profiles.get(n.profile_id);
    if (!p) continue;
    const bypass = limits.notifications.bypass_types.includes(n.type) || n.payload.bypass_limits === true;
    const inCap = limits.notifications.types_in_cap.includes(n.type);
    let decision: ReturnType<typeof decideDelivery> = { action: "send" };
    const key = `${n.profile_id}:${typeof n.payload.guardian_id === "string" ? n.payload.guardian_id : ""}`;
    if (!bypass && inCap && p.age_mode) {
      let s = settingsCache.get(p.id);
      if (!s) { s = await playerSettings(admin, p.id, p.age_mode); settingsCache.set(p.id, s); }
      if (!sentToday.has(key)) {
        const lp = localParts(now, p.timezone);
        const dayStart = new Date(now.getTime() - lp.minutes * 60000).toISOString();
        const { data: todays } = await admin.from("notifications").select("id, type, payload").eq("profile_id", p.id).gte("sent_at", dayStart);
        const cnt = ((todays ?? []) as Array<{ type: string; payload: Record<string, unknown> }>).filter((x) => limits.notifications.types_in_cap.includes(x.type) && `${p.id}:${typeof x.payload.guardian_id === "string" ? x.payload.guardian_id : ""}` === key).length;
        sentToday.set(key, cnt);
      }
      decision = decideDelivery({ now, tz: p.timezone, bypass: false, sentTodayCount: sentToday.get(key)!, maxPerDay: s.maxPerDay, hardCap: limits.notifications.hard_cap_per_day, quiet: s.quiet, notificationTime: s.notificationTime });
    }
    if (decision.action === "defer") { await admin.from("notifications").update({ scheduled_for: decision.until.toISOString(), deferred_count: n.deferred_count + 1 }).eq("id", n.id); deferred++; continue; }
    if (decision.action === "drop") { await admin.from("notifications").update({ sent_at: now.toISOString(), title: null, body: null }).eq("id", n.id); dropped++; continue; }
    const msg = buildMessage(n, p);
    if (!msg) { await admin.from("notifications").update({ sent_at: now.toISOString() }).eq("id", n.id); dropped++; continue; }
    let delivered = false;
    if (sender.enabled && msg.recipientUserId) {
      const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", msg.recipientUserId);
      for (const sub of (subs ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
        const out = await sender.send(sub, { title: msg.title, body: msg.body, url: msg.url, type: n.type, id: n.id });
        if (out === "ok") { delivered = true; pushed++; }
        else if (out === "gone") await admin.from("push_subscriptions").delete().eq("id", sub.id);
        else await admin.from("push_subscriptions").update({ failed_at: now.toISOString() }).eq("id", sub.id);
      }
    }
    await admin.from("notifications").update({ sent_at: now.toISOString(), delivered_at: delivered ? now.toISOString() : null, title: msg.title, body: msg.body, url: msg.url }).eq("id", n.id);
    if (inCap && !bypass) sentToday.set(key, (sentToday.get(key) ?? 0) + 1);
    sent++;
  }
  return { sent, deferred, pushed, dropped };
}

/** 8.4: الحذف التلقائي حسب مدد الاحتفاظ — نصوص المحادثة (chat_auto_delete_days إن فُعّل) والإشعارات القديمة. */
export async function runRetention(admin: SupabaseClient, now = new Date()): Promise<{ messages: number; notifications: number }> {
  let messages = 0;
  const { data: profs } = await admin.from("profiles").select("id").eq("kind", "player");
  for (const p of (profs ?? []) as Array<{ id: string }>) {
    const days = (await effective<number | null>(admin, p.id, "chat_auto_delete_days")).value;
    if (!days) continue;
    const before = new Date(now.getTime() - days * 86400000).toISOString();
    const { data: sessions } = await admin.from("companion_sessions").select("id").eq("profile_id", p.id);
    const ids = ((sessions ?? []) as Array<{ id: string }>).map((s) => s.id);
    if (ids.length === 0) continue;
    const { data: del } = await admin.from("companion_messages").delete().in("session_id", ids).lt("created_at", before).select("id");
    messages += (del as unknown[] | null)?.length ?? 0;
  }
  const cutoff = new Date(now.getTime() - limits.notifications.retention_days * 86400000).toISOString();
  const { data: deln } = await admin.from("notifications").delete().lt("created_at", cutoff).select("id");
  return { messages, notifications: (deln as unknown[] | null)?.length ?? 0 };
}

/** الدورة (كل tick_minutes): تخطيط ← تسليم ← احتفاظ. */
export async function tick(admin: SupabaseClient, sender: PushSender, now = new Date()) {
  const { data: profs } = await admin.from("profiles").select("id, user_id, age_mode, timezone, display_name, kind").eq("kind", "player");
  let planned = 0;
  for (const p of (profs ?? []) as Profile[]) planned += await planForProfile(admin, p, now);
  const delivery = await deliverDue(admin, sender, now);
  const retention = await runRetention(admin, now);
  return { planned, ...delivery, retention };
}
