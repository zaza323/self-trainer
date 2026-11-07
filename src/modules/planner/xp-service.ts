import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { game } from "@/shared/config";
import { amountFor, dailyLimitFor, muhasabaReplacesEvening, taskCompletionXp, type PlannerXpReason } from "./xp";
import type { PlannerTaskRow } from "./types";

type Admin = SupabaseClient;
const dayStartUtc = (now: Date) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

async function todayRows(admin: Admin, profileId: string, now: Date): Promise<Array<{ amount: number; reason: string }>> {
  const { data } = await admin.from("xp_events").select("amount, reason").eq("profile_id", profileId).gte("created_at", dayStartUtc(now));
  return (data ?? []) as Array<{ amount: number; reason: string }>;
}

/**
 * منح XP للمخطط بسبب واحد: الحد اليومي لكل سبب (config)، السقف اليومي العام، UNIQUE(reason, source_id) يمنع التكرار.
 * muhasaba_done يحل محل evening_review_done في اليوم نفسه (ز.5). يعيد المبلغ الممنوح فعلًا.
 */
export async function awardPlannerXp(admin: Admin, profileId: string, reason: PlannerXpReason, sourceId: string, now = new Date()): Promise<number> {
  const rows = await todayRows(admin, profileId, now);
  const sameReason = rows.filter((r) => r.reason === reason).length;
  if (sameReason >= dailyLimitFor(reason)) return 0;
  if (reason === "evening_review_done" && muhasabaReplacesEvening() && rows.some((r) => r.reason === "muhasaba_done")) return 0;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const amount = Math.min(amountFor(reason), Math.max(0, game.xp.daily_cap - total));
  if (amount <= 0) return 0;
  const { data } = await admin.from("xp_events").upsert({ profile_id: profileId, amount, reason, source_id: sourceId, created_at: now.toISOString() }, { onConflict: "reason,source_id", ignoreDuplicates: true }).select("id");
  if (reason === "muhasaba_done" && muhasabaReplacesEvening() && data?.length) {
    // إن مُنح evening_review_done اليوم قبل المحاسبة فلا نسترد (append-only)؛ القاعدة تمنع العكس فقط
  }
  return data?.length ? amount : 0;
}

/** إنجاز مهمة مخطط: XP فقط بشرط التقدير (±tolerance) أو الكتلة (ب.8). */
export async function awardTaskCompletionXp(admin: Admin, task: PlannerTaskRow, now = new Date()): Promise<number> {
  const completedAt = task.completed_at ? new Date(task.completed_at) : now;
  const { data: blocks } = await admin.from("planner_time_blocks").select("id, starts_at, ends_at").eq("task_id", task.id);
  const block = ((blocks ?? []) as Array<{ id: string; starts_at: string; ends_at: string }>).find((b) => completedAt.getTime() >= new Date(b.starts_at).getTime() && completedAt.getTime() <= new Date(b.ends_at).getTime()) ?? null;
  if (block) await admin.from("planner_time_blocks").update({ kept: true }).eq("id", block.id);
  let total = 0;
  for (const a of taskCompletionXp({ taskId: task.id, estimateMin: task.estimate_min, actualMin: task.actual_min, completedAt, block })) total += await awardPlannerXp(admin, task.profile_id, a.reason, a.source_id, now);
  return total;
}
