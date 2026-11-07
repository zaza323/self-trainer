import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { award } from "@/modules/game/service";
import { localParts } from "@/modules/notifications/plan";
import { weekStartOf } from "@/modules/planner/habits";
import { addDays, type WeekStart } from "@/modules/planner/recurrence";
import { suggestRest, restfulWeekReached, type RestSuggestion, type SuggestInput } from "./suggest";

type Db = SupabaseClient;
export type RestSessionRow = { id: string; profile_id: string; activity_key: string; custom_activity_id: string | null; planned_min: number; actual_min: number | null; started_at: string; ended_at: string | null; source: SuggestInput["source"]; feel_after: "more" | "same" | "less" | null; transition_id: string | null };
export type Profile = { id: string; age_mode: AgeMode; timezone: string };

export async function restSettings(db: Db, profileId: string) {
  const [enabled, napOn, napWin, napMin, bedtime, wd] = await Promise.all([
    effective<string[]>(db, profileId, "rest_activities_enabled"), effective<boolean>(db, profileId, "nap_suggestions_enabled"), effective<[string, string]>(db, profileId, "nap_window"),
    effective<number>(db, profileId, "nap_default_min"), effective<string | null>(db, profileId, "target_bedtime"), effective<number>(db, profileId, "wind_down_minutes"),
  ]);
  return { enabled: enabled.value, napEnabled: napOn.value, napWindow: napWin.value, napDefaultMin: napMin.value, bedtime: bedtime.value, windDownMin: wd.value };
}

/** P41: الاقتراحات مرتبة؛ النشاط المخصص من custom_rest_activities؛ ذاكرة الراحة من rest_outcomes. */
export async function restSuggestionsFor(db: Db, p: Profile, now: Date, o: { source: SuggestInput["source"]; gapMin: number | null; pomodoroBreak?: "short" | "long" | null }): Promise<{ shown: RestSuggestion[]; more: RestSuggestion[]; windDown: boolean; firstUse: boolean; settings: Awaited<ReturnType<typeof restSettings>> }> {
  const s = await restSettings(db, p.id);
  const [{ data: custom }, { data: outcomes }, { data: any }] = await Promise.all([
    db.from("custom_rest_activities").select("id, title, default_min").eq("profile_id", p.id).eq("active", true),
    db.from("rest_outcomes").select("activity_key, uses, felt_more_count").eq("profile_id", p.id),
    db.from("rest_sessions").select("id").eq("profile_id", p.id).limit(1),
  ]);
  const out: Record<string, { uses: number; felt_more_count: number }> = {};
  for (const r of (outcomes ?? []) as Array<{ activity_key: string; uses: number; felt_more_count: number }>) out[r.activity_key] = { uses: r.uses, felt_more_count: r.felt_more_count };
  const r = suggestRest({ ageMode: p.age_mode, nowMin: localParts(now, p.timezone).minutes, enabled: s.enabled, custom: (custom ?? []) as Array<{ id: string; title: string; default_min: number }>, gapMin: o.gapMin, napEnabled: s.napEnabled, napWindow: s.napWindow, napDefaultMin: s.napDefaultMin, outcomes: out, bedtime: s.bedtime, windDownMin: s.windDownMin, source: o.source, pomodoroBreak: o.pomodoroBreak ?? null });
  return { ...r, firstUse: !(any?.length), settings: s };
}

export async function startRest(db: Db, p: Profile, i: { activityKey: string; customId?: string | null; plannedMin: number; source: SuggestInput["source"]; transitionId?: string | null; now?: Date }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await db.from("rest_sessions").insert({ profile_id: p.id, activity_key: i.activityKey, custom_activity_id: i.customId ?? null, planned_min: i.plannedMin, source: i.source, transition_id: i.transitionId ?? null, started_at: (i.now ?? new Date()).toISOString() }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** هـ.4/هـ.6: «رجعت» (الوقت الفعلي فقط بلا تعليق) ثم «رجعت مرتاح؟» ⇒ ذاكرة الراحة؛ لا XP؛ إنجاز «راحة تجدّد» بعد 5 في أسبوع. */
export async function endRest(db: Db, admin: Db | null, p: Profile, i: { sessionId: string; feel: "more" | "same" | "less" | null; weekStart: WeekStart; now?: Date }): Promise<{ ok: boolean; actualMin: number; achievement: boolean }> {
  const now = i.now ?? new Date();
  const { data: s } = await db.from("rest_sessions").select("*").eq("id", i.sessionId).maybeSingle();
  if (!s) return { ok: false, actualMin: 0, achievement: false };
  const row = s as RestSessionRow;
  const actualMin = row.ended_at ? (row.actual_min ?? 0) : Math.max(0, Math.round((now.getTime() - new Date(row.started_at).getTime()) / 60000));
  await db.from("rest_sessions").update({ ended_at: row.ended_at ?? now.toISOString(), actual_min: actualMin, feel_after: i.feel }).eq("id", row.id);
  if (!row.ended_at) {
    const { data: o } = await db.from("rest_outcomes").select("uses, felt_more_count").eq("profile_id", p.id).eq("activity_key", row.activity_key).maybeSingle();
    await db.from("rest_outcomes").upsert({ profile_id: p.id, activity_key: row.activity_key, uses: ((o?.uses as number) ?? 0) + 1, felt_more_count: ((o?.felt_more_count as number) ?? 0) + (i.feel === "more" ? 1 : 0), last_used_at: now.toISOString() }, { onConflict: "profile_id,activity_key" });
  } else if (i.feel === "more" && !row.feel_after) {
    const { data: o } = await db.from("rest_outcomes").select("felt_more_count").eq("profile_id", p.id).eq("activity_key", row.activity_key).maybeSingle();
    await db.from("rest_outcomes").update({ felt_more_count: ((o?.felt_more_count as number) ?? 0) + 1 }).eq("profile_id", p.id).eq("activity_key", row.activity_key);
  }
  let achievement = false;
  if (admin) {
    const today = localParts(now, p.timezone).date;
    const ws = weekStartOf(today, i.weekStart);
    const { data: week } = await admin.from("rest_sessions").select("id").eq("profile_id", p.id).not("ended_at", "is", null).gte("started_at", `${ws}T00:00:00Z`).lt("started_at", `${addDays(ws, 7)}T00:00:00Z`);
    if (restfulWeekReached((week ?? []).length)) achievement = await award(admin, p.id, "restful_week", 1, ws, null);
  }
  return { ok: true, actualMin, achievement };
}

/** راحة جارية الآن ⇒ لا «تالي» ولا إشعارات غير عاجلة حتى نهايتها (هـ.4، د.4). */
export async function activeRest(db: Db, profileId: string, now = new Date()): Promise<{ row: RestSessionRow; endsAt: Date } | null> {
  const { data } = await db.from("rest_sessions").select("*").eq("profile_id", profileId).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
  const row = (data ?? [])[0] as RestSessionRow | undefined;
  if (!row) return null;
  const endsAt = new Date(new Date(row.started_at).getTime() + Math.max(1, row.planned_min) * 60000);
  if (endsAt.getTime() + 6 * 3600000 < now.getTime()) return null; // جلسة قديمة نُسيت
  return { row, endsAt };
}

/** «وقت راحة» من بطاقة التالي: يمنع «التالي» حتى نهاية الراحة أو الفراغ (rest_suppress_next_minutes كحد). */
export async function restSuppressedUntil(db: Db, profileId: string, now = new Date()): Promise<Date | null> {
  const a = await activeRest(db, profileId, now);
  return a ? a.endsAt : null;
}
