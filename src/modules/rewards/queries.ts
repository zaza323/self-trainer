import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RewardRow, AchievementOption, GoalOption } from "./components/rewards-panel";
import type { AgeMode } from "@/shared/config";

export async function loadRewardsView(db: SupabaseClient, profileId: string, mode: AgeMode): Promise<{ rewards: RewardRow[]; achievements: AchievementOption[]; goals: GoalOption[]; creatorNames: Record<string, string> }> {
  const [{ data: rewards }, { data: ach }, { data: goals }] = await Promise.all([
    db.from("rewards").select("id, title, description, icon, trigger_type, trigger_params, status, created_by, earned_at").eq("profile_id", profileId).order("created_at", { ascending: false }),
    db.from("achievements").select("code, name_by_mode").eq("active", true),
    db.from("goals").select("id, title").eq("profile_id", profileId).eq("status", "active"),
  ]);
  const rows = (rewards ?? []) as RewardRow[];
  const ids = [...new Set(rows.map((r) => r.created_by))];
  const { data: names } = ids.length ? await db.from("profiles").select("user_id, display_name").in("user_id", ids) : { data: [] };
  return {
    rewards: rows,
    achievements: ((ach ?? []) as Array<{ code: string; name_by_mode: Record<string, string> }>).map((a) => ({ code: a.code, name: a.name_by_mode[mode] ?? a.code })),
    goals: (goals ?? []) as GoalOption[],
    creatorNames: Object.fromEntries(((names ?? []) as Array<{ user_id: string; display_name: string }>).map((n) => [n.user_id, n.display_name])),
  };
}
