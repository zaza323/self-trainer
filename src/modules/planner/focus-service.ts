import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { breakAfter, sessionMinutes } from "./focus";
import { awardPlannerXp } from "./xp-service";

type Db = SupabaseClient;
export type FocusSessionRow = { id: string; profile_id: string; task_id: string | null; started_at: string; ended_at: string | null; minutes: number; completed: boolean; distraction_count: number; returned_after_distraction: boolean | null };

export async function startFocus(db: Db, i: { profileId: string; taskId: string | null; now?: Date }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: open } = await db.from("planner_focus_sessions").select("id").eq("profile_id", i.profileId).is("ended_at", null).limit(1);
  if (open?.length) return { ok: true, id: (open[0] as { id: string }).id };
  const { data, error } = await db.from("planner_focus_sessions").insert({ profile_id: i.profileId, task_id: i.taskId, started_at: (i.now ?? new Date()).toISOString() }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

/** زر «تشتّت» ثم «رجعت؟» (ب.6). القيمة الدليلية P2 في المرحلة 11؛ هنا التسجيل فقط. */
export async function recordDistraction(db: Db, sessionId: string, returned: boolean | null): Promise<void> {
  const { data } = await db.from("planner_focus_sessions").select("distraction_count").eq("id", sessionId).maybeSingle();
  await db.from("planner_focus_sessions").update({ distraction_count: ((data?.distraction_count as number) ?? 0) + (returned === null ? 1 : 0), returned_after_distraction: returned }).eq("id", sessionId);
}

/** إنهاء الجلسة: الدقائق تُضاف إلى المدة الفعلية للمهمة؛ XP focus_session_done بحد 4 يوميًا للمكتملة؛ خطة الاستراحة. */
export async function endFocus(db: Db, admin: Db | null, i: { sessionId: string; completed: boolean; sessionNumberToday: number; shortBreakMin: number; now?: Date }): Promise<{ ok: boolean; minutes: number; xp: number; break: ReturnType<typeof breakAfter> }> {
  const now = i.now ?? new Date();
  const { data: s } = await db.from("planner_focus_sessions").select("*").eq("id", i.sessionId).maybeSingle();
  if (!s) return { ok: false, minutes: 0, xp: 0, break: breakAfter(i.sessionNumberToday, i.shortBreakMin) };
  const row = s as FocusSessionRow;
  const minutes = sessionMinutes(new Date(row.started_at), now);
  await db.from("planner_focus_sessions").update({ ended_at: now.toISOString(), minutes, completed: i.completed }).eq("id", row.id);
  if (row.task_id) {
    const { data: t } = await db.from("planner_tasks").select("actual_min").eq("id", row.task_id).maybeSingle();
    await db.from("planner_tasks").update({ actual_min: ((t?.actual_min as number | null) ?? 0) + minutes }).eq("id", row.task_id);
  }
  let xp = 0;
  if (admin && i.completed) xp = await awardPlannerXp(admin, row.profile_id, "focus_session_done", row.id, now);
  return { ok: true, minutes, xp, break: breakAfter(i.sessionNumberToday, i.shortBreakMin) };
}

export async function activeFocus(db: Db, profileId: string): Promise<FocusSessionRow | null> {
  const { data } = await db.from("planner_focus_sessions").select("*").eq("profile_id", profileId).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
  return ((data ?? [])[0] as FocusSessionRow | undefined) ?? null;
}

export async function focusSessionsOn(db: Db, profileId: string, dayStartIso: string, dayEndIso: string): Promise<FocusSessionRow[]> {
  const { data } = await db.from("planner_focus_sessions").select("*").eq("profile_id", profileId).gte("started_at", dayStartIso).lt("started_at", dayEndIso).order("started_at", { ascending: true });
  return (data ?? []) as FocusSessionRow[];
}
