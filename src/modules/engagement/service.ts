import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limits, type AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { localParts, instantForLocal } from "@/modules/notifications/plan";
import { addDays } from "@/modules/planner/recurrence";
import { activeFocus } from "@/modules/planner/focus-service";
import { activeRest } from "@/modules/rest/service";
import { computeState, followThrough, applyStepUp, applyIgnoreStepDown, dailyBudget, spacingMinutes, isBusy, learnBusyWindows, classifyAbsence, awayNotificationDue, notifResponseWindowHours, notifResponseLastN, engagementConfig, type EngagementState } from "./state";

type Db = SupabaseClient;
export type Profile = { id: string; age_mode: AgeMode; timezone: string };
export type EngagementRow = { profile_id: string; date: string; state: EngagementState; follow_through: number | null; active_days_7: number; notif_response_rate: number | null; computed_at: string };

/** فتح التطبيق: يوم نشاط (و.2). يعيد ساعات الغياب منذ آخر فتح (لـ و.3). */
export async function recordAppOpen(db: Db, p: Profile, now = new Date()): Promise<{ absenceHours: number | null }> {
  const today = localParts(now, p.timezone).date;
  const { data: last } = await db.from("app_opens").select("last_at").eq("profile_id", p.id).order("local_date", { ascending: false }).limit(1);
  const lastAt = ((last ?? [])[0] as { last_at: string } | undefined)?.last_at ?? null;
  const { data: row } = await db.from("app_opens").select("opens").eq("profile_id", p.id).eq("local_date", today).maybeSingle();
  if (row) await db.from("app_opens").update({ last_at: now.toISOString(), opens: (row.opens as number) + 1 }).eq("profile_id", p.id).eq("local_date", today);
  else await db.from("app_opens").insert({ profile_id: p.id, local_date: today, first_at: now.toISOString(), last_at: now.toISOString() });
  return { absenceHours: lastAt ? (now.getTime() - new Date(lastAt).getTime()) / 3600000 : null };
}

/** تحديث «ignored» للإشعارات المحسوبة التي لم تُفتح خلال ساعتين (و.2). */
export async function markIgnored(admin: Db, profileId: string, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - notifResponseWindowHours * 3600000).toISOString();
  const { data } = await admin.from("notifications").select("id, read_at").eq("profile_id", profileId).in("type", limits.notifications.types_in_cap).is("ignored", null).not("sent_at", "is", null).lte("sent_at", cutoff);
  for (const n of (data ?? []) as Array<{ id: string; read_at: string | null }>) await admin.from("notifications").update({ ignored: n.read_at === null }).eq("id", n.id);
}

/** و.2: تُحسب يوميًا (وعند الطلب). الصعود خطوة واحدة يوميًا، الهبوط فوري. */
export async function computeEngagement(admin: Db, p: Profile, now = new Date()): Promise<EngagementRow> {
  const today = localParts(now, p.timezone).date;
  const since7 = addDays(today, -7);
  const [{ data: opens }, { data: fus }, { data: notifs }, { data: prev }, brk, { data: doneTasks }, { data: checkins }] = await Promise.all([
    admin.from("app_opens").select("local_date").eq("profile_id", p.id).gte("local_date", since7),
    admin.from("planner_followups").select("occurrence_date, status, answered_at").eq("profile_id", p.id).gte("occurrence_date", since7),
    admin.from("notifications").select("id, sent_at, read_at, ignored").eq("profile_id", p.id).in("type", limits.notifications.types_in_cap).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(notifResponseLastN),
    admin.from("engagement_states").select("*").eq("profile_id", p.id).lt("date", today).order("date", { ascending: false }).limit(1),
    effective<boolean>(admin, p.id, "break_mode"),
    admin.from("planner_tasks").select("completed_at").eq("profile_id", p.id).eq("status", "done").gte("completed_at", new Date(now.getTime() - 86400000).toISOString()),
    admin.from("daily_checkins").select("local_date, top_priorities, status").eq("profile_id", p.id).gte("local_date", since7).eq("status", "answered"),
  ]);
  await markIgnored(admin, p.id, now);
  // الالتزام: لكل يوم المنجز ÷ (المنجز + ما صار) من ردود «تمّت؟» (+ الأولويات غير المنجزة لا تدخل هنا: لا بيانات إنجاز لها إلا عبر المهام)
  const byDay = new Map<string, { done: number; missed: number }>();
  for (const f of (fus ?? []) as Array<{ occurrence_date: string; status: string }>) {
    const d = byDay.get(f.occurrence_date) ?? { done: 0, missed: 0 };
    if (f.status === "done" || f.status === "partial") d.done++; else if (f.status === "missed") d.missed++;
    byDay.set(f.occurrence_date, d);
  }
  const ratios: Array<number | null> = [];
  for (let i = 7; i >= 1; i--) { const d = byDay.get(addDays(today, -i)); ratios.push(d && d.done + d.missed > 0 ? d.done / (d.done + d.missed) : null); }
  const ft = followThrough(ratios);
  const activeDays = new Set([...((opens ?? []) as Array<{ local_date: string }>).map((o) => o.local_date), ...((fus ?? []) as Array<{ occurrence_date: string; answered_at: string | null }>).filter((f) => f.answered_at).map((f) => f.occurrence_date), ...((checkins ?? []) as Array<{ local_date: string }>).map((c) => c.local_date)]).size;
  const wins24 = ((doneTasks ?? []).length) + ((fus ?? []) as Array<{ status: string; answered_at: string | null }>).filter((f) => f.status === "done" && f.answered_at && new Date(f.answered_at).getTime() >= now.getTime() - 86400000).length;
  const ns = (notifs ?? []) as Array<{ ignored: boolean | null }>;
  let ignoredInRow = 0; for (const n of ns) { if (n.ignored === true) ignoredInRow++; else if (n.ignored === false) break; }
  const responded = ns.filter((n) => n.ignored === false).length;
  const lastOpen = ((opens ?? []) as Array<{ local_date: string }>).map((o) => o.local_date).sort().at(-1);
  const { data: lastEver } = lastOpen ? { data: null } : await admin.from("app_opens").select("local_date").eq("profile_id", p.id).order("local_date", { ascending: false }).limit(1);
  const lastOpenDate = lastOpen ?? ((lastEver ?? [])[0] as { local_date: string } | undefined)?.local_date ?? null;
  const daysSinceOpen = lastOpenDate ? Math.max(0, Math.round((new Date(today).getTime() - new Date(lastOpenDate).getTime()) / 86400000)) : 0;
  const computed = computeState({ followThrough: ft, activeDays7: activeDays, winsLast24h: wins24, ignoredInRow, daysSinceOpen, breakMode: brk.value });
  const previous = ((prev ?? [])[0] as EngagementRow | undefined)?.state ?? null;
  const state = applyIgnoreStepDown(applyStepUp(previous, computed), ignoredInRow);
  const row: EngagementRow = { profile_id: p.id, date: today, state, follow_through: ft, active_days_7: activeDays, notif_response_rate: ns.length ? Number((responded / ns.length).toFixed(2)) : null, computed_at: now.toISOString() };
  await admin.from("engagement_states").upsert(row, { onConflict: "profile_id,date" });
  return row;
}

export async function currentState(db: Db, profileId: string): Promise<EngagementState> {
  const { data } = await db.from("engagement_states").select("state").eq("profile_id", profileId).order("date", { ascending: false }).limit(1);
  return (((data ?? [])[0] as { state: EngagementState } | undefined)?.state) ?? "steady";
}

/** «مشغول» الآن: تركيز جارٍ، كتلة جارية، عنصر مجدول جارٍ، نافذة انشغال متعلَّمة، «لا تزعجني»، أو راحة جارية (هـ.4). */
export async function busyNow(db: Db, p: Profile, now = new Date()): Promise<boolean> {
  const lp = localParts(now, p.timezone);
  const [focus, rest, { data: blocks }, { data: windows }, { data: dnd }, { data: tasks }] = await Promise.all([
    activeFocus(db, p.id), activeRest(db, p.id, now),
    db.from("planner_time_blocks").select("id").eq("profile_id", p.id).lte("starts_at", now.toISOString()).gte("ends_at", now.toISOString()).limit(1),
    db.from("busy_windows").select("weekday, start_hour, end_hour").eq("profile_id", p.id).eq("active", true),
    db.from("dnd_periods").select("id, ends_at, kind").eq("profile_id", p.id).lte("starts_at", now.toISOString()),
    db.from("planner_tasks").select("due_time, estimate_min").eq("profile_id", p.id).eq("status", "open").eq("due_date", lp.date).not("due_time", "is", null),
  ]);
  const hour = Math.floor(lp.minutes / 60);
  const inWindow = ((windows ?? []) as Array<{ weekday: number; start_hour: number; end_hour: number }>).some((w) => w.weekday === lp.weekday && hour >= w.start_hour && hour < w.end_hour);
  const dndActive = ((dnd ?? []) as Array<{ ends_at: string | null; kind: string }>).some((d) => (d.ends_at === null && d.kind === "until_task") || (d.ends_at !== null && new Date(d.ends_at).getTime() > now.getTime()));
  const scheduledNow = ((tasks ?? []) as Array<{ due_time: string; estimate_min: number | null }>).some((t) => { const [h, m] = t.due_time.split(":").map(Number); const s = h! * 60 + m!; return lp.minutes >= s && lp.minutes < s + (t.estimate_min ?? 30); });
  return isBusy({ focusActive: Boolean(focus), blockActive: Boolean(blocks?.length), scheduledNow, inLearnedBusyWindow: inWindow, dndActive: dndActive || Boolean(rest) });
}

/** و.4: ميزانية اليوم + التباعد لهذا الملف الآن (تُستخدم في التسليم). */
export async function budgetFor(admin: Db, p: Profile, now = new Date()): Promise<{ state: EngagementState; perDay: number; spacingMin: number; busy: boolean }> {
  const [state, brk, userMax, busy] = await Promise.all([currentState(admin, p.id), effective<boolean>(admin, p.id, "break_mode"), effective<number | "auto">(admin, p.id, "notification_max_per_day"), busyNow(admin, p, now)]);
  return { state, perDay: dailyBudget({ state, ageMode: p.age_mode, breakMode: brk.value, busy, userMax: userMax.value }), spacingMin: spacingMinutes(state), busy };
}

/** و.5 «لا تزعجني». */
export async function startDnd(db: Db, profileId: string, kind: "1h" | "2h" | "until_task" | "until_tomorrow", tz: string, now = new Date()): Promise<void> {
  const ends = kind === "1h" ? new Date(now.getTime() + 3600000) : kind === "2h" ? new Date(now.getTime() + 7200000) : kind === "until_tomorrow" ? instantForLocal(addDays(localParts(now, tz).date, 1), "07:00", tz) : null;
  await db.from("dnd_periods").insert({ profile_id: profileId, starts_at: now.toISOString(), ends_at: ends ? ends.toISOString() : null, kind });
}
export async function endDnd(db: Db, profileId: string, now = new Date()): Promise<void> {
  await db.from("dnd_periods").update({ ends_at: now.toISOString() }).eq("profile_id", profileId).is("ends_at", null);
  await db.from("dnd_periods").update({ ends_at: now.toISOString() }).eq("profile_id", profileId).gt("ends_at", now.toISOString());
}

/** و.3: إنجاز بأثر رجعي — بلا XP وبلا أدلة؛ يُحسب في الإحصائيات ونوافذ الانشغال. */
export async function addRetroCompletion(db: Db, profileId: string, i: { title: string; approxAt: string; linkedTaskId?: string | null }): Promise<{ ok: boolean }> {
  const { error } = await db.from("retro_completions").insert({ profile_id: profileId, title: i.title.trim(), approx_at: i.approxAt, linked_task_id: i.linkedTaskId ?? null });
  return { ok: !error };
}

/** و.3: تصنيف الغياب بعد العودة (منتج / غير منتج) وأثره على الحالة. */
export async function classifyReturn(admin: Db, p: Profile, i: { absenceHours: number; scheduledCount: number; doneCount: number; now?: Date }): Promise<"productive" | "unproductive" | null> {
  const now = i.now ?? new Date();
  const { data: retro } = await admin.from("retro_completions").select("id").eq("profile_id", p.id).gte("created_at", new Date(now.getTime() - 3600000).toISOString());
  const r = classifyAbsence({ absenceHours: i.absenceHours, scheduledCount: i.scheduledCount, doneCount: i.doneCount, retroCount: (retro ?? []).length });
  if (r === "unproductive") {
    const today = localParts(now, p.timezone).date;
    await admin.from("engagement_states").upsert({ profile_id: p.id, date: today, state: "low", computed_at: now.toISOString() }, { onConflict: "profile_id,date" });
  }
  return r;
}

/** و.3: تعلّم نوافذ الانشغال من الإنجازات المسجّلة لاحقًا (رجعية أو «تمّت» بعد ساعتين من انتهاء العنصر) خلال 4 أسابيع. */
export async function learnBusyWindowsFor(admin: Db, p: Profile, now = new Date()): Promise<number> {
  const learn = await effective<boolean>(admin, p.id, "learn_busy_windows");
  if (!learn.value) return 0;
  const since = new Date(now.getTime() - engagementConfig.busy_windows.lookback_weeks * 7 * 86400000).toISOString();
  const [{ data: retro }, { data: late }] = await Promise.all([
    admin.from("retro_completions").select("approx_at").eq("profile_id", p.id).gte("approx_at", since),
    admin.from("planner_followups").select("scheduled_end, answered_at").eq("profile_id", p.id).eq("status", "done").gte("scheduled_end", since),
  ]);
  const events = [...((retro ?? []) as Array<{ approx_at: string }>).map((r) => r.approx_at), ...((late ?? []) as Array<{ scheduled_end: string; answered_at: string | null }>).filter((f) => f.answered_at && new Date(f.answered_at).getTime() - new Date(f.scheduled_end).getTime() > 2 * 3600000).map((f) => f.scheduled_end)]
    .map((iso) => { const lp = localParts(new Date(iso), p.timezone); return { weekday: lp.weekday, hour: Math.floor(lp.minutes / 60) }; });
  const windows = learnBusyWindows(events);
  for (const w of windows) await admin.from("busy_windows").upsert({ profile_id: p.id, weekday: w.weekday, start_hour: w.start_hour, end_hour: w.end_hour, source: "learned", evidence_count: w.evidence_count, active: true }, { onConflict: "profile_id,weekday,start_hour", ignoreDuplicates: true });
  return windows.length;
}

/** و.4 away: إشعار واحد بإيقاع الغياب؛ يُستدعى من الدورة المجدولة. */
export async function maybeAwayNotification(admin: Db, p: Profile, now = new Date()): Promise<boolean> {
  const state = await currentState(admin, p.id);
  if (state !== "away") return false;
  const { data: lastOpen } = await admin.from("app_opens").select("local_date").eq("profile_id", p.id).order("local_date", { ascending: false }).limit(1);
  const lastDate = ((lastOpen ?? [])[0] as { local_date: string } | undefined)?.local_date;
  if (!lastDate) return false;
  const daysAway = Math.round((new Date(localParts(now, p.timezone).date).getTime() - new Date(lastDate).getTime()) / 86400000);
  const { data: lastNotif } = await admin.from("notifications").select("created_at").eq("profile_id", p.id).eq("type", "away_checkin").order("created_at", { ascending: false }).limit(1);
  const lastAt = ((lastNotif ?? [])[0] as { created_at: string } | undefined)?.created_at;
  const sinceLast = lastAt ? (now.getTime() - new Date(lastAt).getTime()) / 86400000 : null;
  if (!awayNotificationDue(daysAway, sinceLast)) return false;
  const { data } = await admin.from("notifications").upsert({ profile_id: p.id, type: "away_checkin", dedupe_key: `away:${p.id}:${localParts(now, p.timezone).date}`, payload: { days_away: daysAway } }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  return Boolean(data?.length);
}
