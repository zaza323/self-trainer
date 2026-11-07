import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limits, planner, type AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { decideDelivery, localParts, nextDailySlot, resolveMaxPerDay, instantForLocal, type TimeRange } from "./plan";
import { renderNotification, urlForNotification, containsForbidden, type Audience } from "./texts";
import type { PushSender } from "./sender";
import { firePlannerReminders } from "@/modules/planner/service";
import { budgetFor, computeEngagement, maybeAwayNotification, learnBusyWindowsFor } from "@/modules/engagement/service";
import { engagementConfig } from "@/modules/engagement/state";
import { evaluateDayPlanEvidence, momentSettings, effectiveMomentsForPush } from "@/modules/moments/service";
import { evaluateMuhasabaNextDay } from "@/modules/muhasaba/service";
import { pendingFollowups } from "@/modules/followups/service";
import { addDays } from "@/modules/planner/recurrence";
import { resolveWindow } from "@/modules/moments/openers";
import openersContent from "@content/daily_openers.ar.json";
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
export function buildMessage(n: NotifRow, p: Profile, state: string | null = null, now = new Date()): { audience: Audience; recipientUserId: string | null; title: string; body: string; url: string } | null {
  const guardianId = typeof n.payload.guardian_id === "string" ? n.payload.guardian_id : null;
  const audience: Audience = guardianId ? "guardian" : (p.age_mode ?? "adult");
  const rotation = Number(localParts(now, p.timezone).date.replace(/-/g, "")) % 7;
  const r = renderNotification(n.type, audience, { name: p.display_name, title: typeof n.payload.title === "string" ? n.payload.title : "", capability: typeof n.payload.capability_id === "string" ? capName(n.payload.capability_id) : "", moment_name: typeof n.payload.moment === "string" ? (openersContent.moment_names as Record<string, string>)[n.payload.moment] ?? "" : "", summary: typeof n.payload.summary === "string" ? n.payload.summary : "", n: typeof n.payload.n === "number" ? n.payload.n : "" }, guardianId ? null : state, rotation);
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
  let sent = 0, deferred = 0, pushed = 0, dropped = 0;
  const settingsCache = new Map<string, Awaited<ReturnType<typeof playerSettings>>>();
  const budgetCache = new Map<string, Awaited<ReturnType<typeof budgetFor>>>();
  const stateByProfile = new Map<string, string>();
  const sentToday = new Map<string, number>();
  const lastSentAt = new Map<string, string | null>();
  const bundledIds = new Set<string>();
  for (let n of rows) {
    if (bundledIds.has(n.id)) continue;
    const p = profiles.get(n.profile_id);
    if (!p) continue;
    const bypass = limits.notifications.bypass_types.includes(n.type) || n.payload.bypass_limits === true;
    const inCap = limits.notifications.types_in_cap.includes(n.type);
    // 0.4 ب.5: تذكير ضبطه المستخدم بنفسه — خارج الحد اليومي؛ يحترم ساعات الهدوء إلا إذا وُسم «مهم»
    const userSet = limits.notifications.user_set_types.includes(n.type);
    let decision: ReturnType<typeof decideDelivery> = { action: "send" };
    const key = `${n.profile_id}:${typeof n.payload.guardian_id === "string" ? n.payload.guardian_id : ""}`;
    if (userSet && !bypass && p.age_mode && n.payload.important !== true) {
      let s = settingsCache.get(p.id);
      if (!s) { s = await playerSettings(admin, p.id, p.age_mode); settingsCache.set(p.id, s); }
      decision = decideDelivery({ now, tz: p.timezone, bypass: false, sentTodayCount: 0, maxPerDay: Number.MAX_SAFE_INTEGER, hardCap: Number.MAX_SAFE_INTEGER, quiet: s.quiet, notificationTime: s.notificationTime });
    } else if (!bypass && inCap && p.age_mode) {
      // 0.4 و.4: الميزانية حسب حالة التفاعل، التباعد، الانشغال (صمت ثم إشعار مجمّع)، away بإيقاعه الخاص
      let b = budgetCache.get(p.id);
      if (!b) { b = await budgetFor(admin, p as unknown as Parameters<typeof budgetFor>[1], now); budgetCache.set(p.id, b); }
      stateByProfile.set(p.id, b.state);
      let s = settingsCache.get(p.id);
      if (!s) { s = await playerSettings(admin, p.id, p.age_mode); settingsCache.set(p.id, s); }
      if (!sentToday.has(key)) {
        const lp = localParts(now, p.timezone);
        const dayStart = new Date(now.getTime() - lp.minutes * 60000).toISOString();
        const { data: todays } = await admin.from("notifications").select("id, type, payload, sent_at").eq("profile_id", p.id).gte("sent_at", dayStart).order("sent_at", { ascending: false });
        const mine = ((todays ?? []) as Array<{ type: string; payload: Record<string, unknown>; sent_at: string }>).filter((x) => limits.notifications.types_in_cap.includes(x.type) && `${p.id}:${typeof x.payload.guardian_id === "string" ? x.payload.guardian_id : ""}` === key && x.payload.bundled !== true);
        sentToday.set(key, mine.length);
        lastSentAt.set(key, mine[0]?.sent_at ?? null);
      }
      if (b.state === "away" && n.type !== "away_checkin") { await admin.from("notifications").update({ sent_at: now.toISOString(), title: null, body: null, state_at_send: b.state }).eq("id", n.id); dropped++; continue; }
      if (b.busy) {
        // صمت تام أثناء الانشغال؛ ما تأخر يُجمع عند انتهائه (busy_bundle_on_end)
        await admin.from("notifications").update({ payload: { ...n.payload, busy_deferred: true } }).eq("id", n.id);
        decision = { action: "defer", until: new Date(now.getTime() + b.spacingMin * 60000), reason: "cap" };
      } else {
        const pendingSame = rows.filter((x) => x.id !== n.id && x.profile_id === p.id && x.payload.busy_deferred === true && limits.notifications.types_in_cap.includes(x.type) && !bundledIds.has(x.id));
        const wasBusyDeferred = n.payload.busy_deferred === true && pendingSame.length > 0 && n.payload.guardian_id === undefined;
        if (wasBusyDeferred) {
          // إشعار واحد مجمّع عند انتهاء الانشغال
          for (const x of pendingSame) { bundledIds.add(x.id); await admin.from("notifications").update({ sent_at: now.toISOString(), title: null, body: null, state_at_send: b.state, payload: { ...x.payload, bundled: true } }).eq("id", x.id); }
          n = { ...n, type: "busy_bundle", payload: { ...n.payload, n: pendingSame.length + 1, bundle_of: n.type } };
          await admin.from("notifications").update({ type: "busy_bundle", bundled_ids: pendingSame.map((x) => x.id), payload: n.payload }).eq("id", n.id);
        }
        const last = lastSentAt.get(key);
        const spacingOk = !last || (now.getTime() - new Date(last).getTime()) / 60000 >= b.spacingMin;
        // و.4: السقف الصلب حسب الوضع العمري (child 3، teen 6، adult 6) حاجز لا يُضبط
        decision = decideDelivery({ now, tz: p.timezone, bypass: false, sentTodayCount: sentToday.get(key)!, maxPerDay: b.perDay, hardCap: engagementConfig.ceiling[p.age_mode], quiet: s.quiet, notificationTime: s.notificationTime });
        if (decision.action === "send" && !spacingOk) decision = { action: "defer", until: new Date(new Date(last!).getTime() + b.spacingMin * 60000), reason: "cap" };
      }
    }
    if (decision.action === "defer") { await admin.from("notifications").update({ scheduled_for: decision.until.toISOString(), deferred_count: n.deferred_count + 1 }).eq("id", n.id); deferred++; continue; }
    if (decision.action === "drop") { await admin.from("notifications").update({ sent_at: now.toISOString(), title: null, body: null }).eq("id", n.id); dropped++; continue; }
    const msg = buildMessage(n, p, stateByProfile.get(p.id) ?? null, now);
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
    await admin.from("notifications").update({ sent_at: now.toISOString(), delivered_at: delivered ? now.toISOString() : null, title: msg.title, body: msg.body, url: msg.url, state_at_send: stateByProfile.get(p.id) ?? null }).eq("id", n.id);
    if (inCap && !bypass) { sentToday.set(key, (sentToday.get(key) ?? 0) + 1); lastSentAt.set(key, now.toISOString()); }
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
  const reminders = await firePlannerReminders(admin, now); // 0.4 ب.5
  let moments = 0, followups = 0, away = 0;
  for (const p of (profs ?? []) as Profile[]) {
    if (p.kind !== "player" || !p.age_mode) continue;
    try { const r = await dailyEngagementTick(admin, p, now); moments += r.moments; followups += r.followups; away += r.away ? 1 : 0; } catch (e) { console.error("engagement tick failed", e); }
  }
  const delivery = await deliverDue(admin, sender, now);
  const retention = await runRetention(admin, now);
  return { planned, reminders: reminders.fired, moments, followups, away, ...delivery, retention };
}


/**
 * 0.4 (و، ج، د): لكل متدرب في الدورة — حالة التفاعل (مرة يوميًا)، أدلة خطة اليوم لأمس وM2، نوافذ الانشغال، إشعار الغياب،
 * إشعارات اللحظات الاختيارية (الملخص الصباحي/المسائي هما إشعارا الصباح والمساء)، وإشعار «خلصت؟» الاختياري.
 */
export async function dailyEngagementTick(admin: SupabaseClient, p: Profile, now = new Date()): Promise<{ moments: number; followups: number; away: boolean }> {
  const lp = localParts(now, p.timezone);
  const prof = { id: p.id, user_id: p.user_id, age_mode: p.age_mode!, timezone: p.timezone, display_name: p.display_name };
  const { data: todayState } = await admin.from("engagement_states").select("date").eq("profile_id", p.id).eq("date", lp.date).maybeSingle();
  if (!todayState) {
    await computeEngagement(admin, prof, now);
    await evaluateDayPlanEvidence(admin, prof, addDays(lp.date, -1), now);
    await evaluateMuhasabaNextDay(admin, prof, lp.date, now);
    if (lp.weekday === 0) await learnBusyWindowsFor(admin, prof, now);
  }
  const away = await maybeAwayNotification(admin, prof, now);
  const ms = await momentSettings(admin, p.id);
  let moments = 0, followups = 0;
  if (ms.push && !ms.breakMode) {
    const tokens = { quietStart: ms.quiet?.[0] ?? null, windDownStart: null };
    for (const m of effectiveMomentsForPush(ms.enabled)) {
      const w = ms.windows[m]; if (!w) continue;
      const r = resolveWindow(w, tokens); if (!r) continue;
      const start = instantForLocal(lp.date, `${String(Math.floor(r[0] / 60)).padStart(2, "0")}:${String(r[0] % 60).padStart(2, "0")}`, p.timezone);
      if (start.getTime() - now.getTime() > limits.notifications.planner_lookahead_hours * 3600000) continue;
      const { data: shown } = await admin.from("daily_checkins").select("id").eq("profile_id", p.id).eq("local_date", lp.date).eq("moment", m).limit(1);
      if (shown?.length) continue;
      const { data } = await admin.from("notifications").upsert({ profile_id: p.id, type: "daily_moment", dedupe_key: `daily_moment:${p.id}:${lp.date}:${m}`, scheduled_for: start.toISOString(), payload: { moment: m, summary: "" } }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
      moments += data?.length ?? 0;
    }
  }
  const fuPush = (await effective<boolean>(admin, p.id, "followup_push")).value;
  if (fuPush) {
    const weekStart = (await effective<"sat" | "sun" | "mon">(admin, p.id, "week_start_day")).value;
    const pend = await pendingFollowups(admin, prof, now, weekStart);
    for (const f of pend.items.filter((x) => x.status === "pending")) {
      const { data } = await admin.from("notifications").upsert({ profile_id: p.id, type: "followup_push", dedupe_key: `followup_push:${f.id}`, payload: { title: f.title, followup_id: f.id } }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
      followups += data?.length ?? 0;
    }
  }
  return { moments, followups, away };
}
