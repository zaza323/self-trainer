import "server-only";
import { createClient } from "@/shared/db/server";
import type { GoalNode } from "./tree";

export type GoalRow = GoalNode & { profile_id: string; proposed_by: "player" | "guardian"; created_at: string };

export async function getGoals(profileId: string): Promise<GoalRow[]> {
  const db = await createClient();
  const { data, error } = await db.from("goals").select("*").eq("profile_id", profileId).order("created_at");
  if (error) throw error;
  return (data ?? []) as GoalRow[];
}
