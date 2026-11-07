import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { game } from "@/shared/config";
import { award } from "@/modules/game/service";
import { instantForLocal } from "@/modules/notifications/plan";
import { addDays, type WeekStart } from "./recurrence";
import { weekStartOf } from "./habits";
import { awardPlannerXp } from "./xp-service";
import { focusSessionsOn } from "./focus-service";

type Db = SupabaseClient;
export type WeeklyReviewRow = { id: string; profile_id: string; week_start: string; done_summary: string | null; postponed_summary: string | null; next_priorities: Array<{ text: string; task_id: string | null }>; session_id: string | null; created_at: string };

export async function getOrCreateReview(db: Db, profileId: string, today: string, weekStart: WeekStart): Promise<WeeklyReviewRow> {
  const ws = weekStartOf(today, weekStart);
  const { data } = await db.from("weekly_reviews").select("*").eq("profile_id", profileId).eq("week_start", ws).maybeSingle();
  if (data) return data as WeeklyReviewRow;
  const { data: created, error } = await db.from("weekly_reviews").insert({ profile_id: profileId, week_start: ws }).select("*").single();
  if (error) throw error;
  return created as WeeklyReviewRow;
}

/** ب.9: شو خلصت ← شو تأجل وليش ← أهم 3 للأسبوع الجاي (free_text دائمًا، بكلمات المستخدم). عند الاكتمال: XP weekly_review_done + «أول أسبوع كامل». */
export async function saveReviewStep(db: Db, admin: Db | null, i: { reviewId: string; profileId: string; step: "done" | "postponed" | "next"; text?: string; priorities?: Array<{ text: string; task_id: string | null }>; tz: string; weekStart: WeekStart; now?: Date }): Promise<{ completed: boolean; xp: number; achievement: boolean }> {
  const patch: Record<string, unknown> = i.step === "done" ? { done_summary: i.text ?? "" } : i.step === "postponed" ? { postponed_summary: i.text ?? "" } : { next_priorities: (i.priorities ?? []).slice(0, 3) };
  await db.from("weekly_reviews").update(patch).eq("id", i.reviewId);
  if (i.step !== "next" || !(i.priorities?.length)) return { completed: false, xp: 0, achievement: false };
  let xp = 0, achievement = false;
  if (admin) {
    xp = await awardPlannerXp(admin, i.profileId, "weekly_review_done", i.reviewId, i.now);
    const { data: r } = await admin.from("weekly_reviews").select("week_start").eq("id", i.reviewId).single();
    const ws = (r as { week_start: string }).week_start;
    const start = instantForLocal(ws, "00:00", i.tz).toISOString(), end = instantForLocal(addDays(ws, 7), "00:00", i.tz).toISOString();
    const sessions = await focusSessionsOn(admin, i.profileId, start, end);
    const days = new Set(sessions.filter((s) => s.completed).map((s) => s.started_at.slice(0, 10))).size;
    const need = Number((game.achievements.first_full_week.requires.find((x) => x.startsWith("focus_session_on_days")) ?? "focus_session_on_days>=5").split(">=")[1]);
    if (days >= need) achievement = await award(admin, i.profileId, "first_full_week", 1, "", null);
  }
  return { completed: true, xp, achievement };
}
