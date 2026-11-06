import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileRow } from "@/shared/db/types";
import type { AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { capabilityView } from "@/modules/game/service";
import { todayIn } from "@/modules/missions/queries";
import { loadPlannerTier } from "./service";
import type { WeekStart } from "./recurrence";

/** سياق صفحات «أدواتي»: المستوى الفعّال وأدواته، اليوم المحلي، بداية الأسبوع، وحد الساعة الغامضة. */
export async function loadPlannerContext(db: SupabaseClient, profile: ProfileRow) {
  const caps = await capabilityView(db, profile.id);
  const [tier, weekStart, pmUntil] = await Promise.all([
    loadPlannerTier(db, { id: profile.id, age_mode: profile.age_mode as AgeMode, incentive_stage: profile.incentive_stage, planner_tier_max: profile.planner_tier_max ?? 0, timezone: profile.timezone }, caps),
    effective<WeekStart>(db, profile.id, "week_start_day"),
    effective<number>(db, profile.id, "ambiguous_hour_pm_until"),
  ]);
  return { tier, weekStart: weekStart.value, ambiguousPmUntil: pmUntil.value, today: todayIn(profile.timezone), tz: profile.timezone };
}
