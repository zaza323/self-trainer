import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;
export type BlockRow = { id: string; profile_id: string; task_id: string | null; starts_at: string; ends_at: string; kept: boolean | null };

/** التعارض يُعلَّم ولا يُمنع (ب.6). */
export function conflictsWith(block: { starts_at: string; ends_at: string; id?: string }, others: BlockRow[]): BlockRow[] {
  const s = new Date(block.starts_at).getTime(), e = new Date(block.ends_at).getTime();
  return others.filter((o) => o.id !== block.id && new Date(o.starts_at).getTime() < e && new Date(o.ends_at).getTime() > s);
}

export async function createBlock(db: Db, i: { profileId: string; taskId: string | null; startsAt: string; endsAt: string }): Promise<{ ok: true; id: string; conflicts: number } | { ok: false; error: string }> {
  if (new Date(i.endsAt) <= new Date(i.startsAt)) return { ok: false, error: "invalid_range" };
  const { data: others } = await db.from("planner_time_blocks").select("*").eq("profile_id", i.profileId);
  const conflicts = conflictsWith({ starts_at: i.startsAt, ends_at: i.endsAt }, (others ?? []) as BlockRow[]).length;
  const { data, error } = await db.from("planner_time_blocks").insert({ profile_id: i.profileId, task_id: i.taskId, starts_at: i.startsAt, ends_at: i.endsAt }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string, conflicts };
}

export async function deleteBlock(db: Db, id: string): Promise<void> { await db.from("planner_time_blocks").delete().eq("id", id); }

export async function blocksBetween(db: Db, profileId: string, fromIso: string, toIso: string): Promise<BlockRow[]> {
  const { data } = await db.from("planner_time_blocks").select("*").eq("profile_id", profileId).gte("starts_at", fromIso).lt("starts_at", toIso).order("starts_at", { ascending: true });
  return (data ?? []) as BlockRow[];
}
