import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrainingLevel } from "@/shared/config";
import { triggerSatisfied, type TriggerFacts, type TriggerType } from "./triggers";

/**
 * REWARD-4 / GAME-10: تقييم محفزات المكافآت النشطة والإنجازات الخاصة عند كل reflected وtransferred ومنح إنجاز وتغيير مستوى تدريب.
 * الوقائع تُحسب منذ activated_at لكل مكافأة (لا أثر رجعي). يعمل بعميل الخدمة؛ idempotent.
 */
export async function evaluateRewardTriggers(admin: SupabaseClient, profileId: string, now = new Date()): Promise<{ earned: string[]; achievements: string[] }> {
  const [{ data: rewards }, { data: custom }, { data: states }] = await Promise.all([
    admin.from("rewards").select("id, title, trigger_type, trigger_params, activated_at, created_by").eq("profile_id", profileId).eq("status", "active"),
    admin.from("achievements").select("id, code, trigger_type, trigger_params, created_at").eq("owner_profile_id", profileId).eq("active", true),
    admin.from("capability_states").select("capability_id, training_level, mastered").eq("profile_id", profileId),
  ]);
  const earned: string[] = [], achievements: string[] = [];
  const levels: Record<string, TrainingLevel | "mastered"> = {};
  for (const s of (states ?? []) as Array<{ capability_id: string; training_level: TrainingLevel; mastered: boolean }>) levels[s.capability_id] = s.mastered ? "mastered" : s.training_level;

  const factsSince = async (since: string): Promise<TriggerFacts> => {
    const [{ data: ms }, { data: tr }, { data: pa }, { data: goals }] = await Promise.all([
      admin.from("missions").select("template_id, template_version, gate2, completed_at").eq("profile_id", profileId).eq("gate2", "shown").gte("completed_at", since),
      admin.from("transfer_reports").select("worked, context_tag").eq("profile_id", profileId).gte("created_at", since),
      admin.from("profile_achievements").select("achievement_id, earned_at").eq("profile_id", profileId).gte("earned_at", since),
      admin.from("goals").select("id, updated_at").eq("profile_id", profileId).eq("status", "completed").gte("updated_at", since),
    ]);
    const shown: Record<string, number> = {};
    for (const m of (ms ?? []) as Array<{ template_id: string; template_version: number }>) {
      const { data: caps } = await admin.from("template_capabilities").select("capability_id, weight").eq("template_id", m.template_id).eq("template_version", m.template_version).order("weight", { ascending: false }).limit(1);
      const cap = (caps ?? [])[0]?.capability_id as string | undefined;
      if (cap) shown[cap] = (shown[cap] ?? 0) + 1;
    }
    const achIds = ((pa ?? []) as Array<{ achievement_id: string }>).map((a) => a.achievement_id);
    const { data: achRows } = achIds.length ? await admin.from("achievements").select("id, code").in("id", achIds) : { data: [] };
    return {
      shownByCapability: shown, trainingLevelByCapability: levels,
      transferReports: (tr ?? []) as Array<{ worked: boolean; context_tag: string }>,
      achievementCodes: ((achRows ?? []) as Array<{ code: string }>).map((a) => a.code),
      completedGoalIds: ((goals ?? []) as Array<{ id: string }>).map((g) => g.id),
    };
  };

  for (const r of (rewards ?? []) as Array<{ id: string; title: string; trigger_type: TriggerType; trigger_params: Record<string, unknown>; activated_at: string | null; created_by: string }>) {
    const facts = await factsSince(r.activated_at ?? now.toISOString());
    if (!triggerSatisfied(r.trigger_type, r.trigger_params, facts)) continue;
    const { data } = await admin.from("rewards").update({ status: "earned" }).eq("id", r.id).eq("status", "active").select("id");
    if (!data?.length) continue;
    earned.push(r.id);
    // 5.7: إشعار للمتدرب وللمربين أصحاب add_rewards
    await admin.from("notifications").insert({ profile_id: profileId, type: "reward_earned", payload: { reward_id: r.id, title: r.title } });
    const { data: links } = await admin.from("guardian_links").select("guardian_id, permissions").eq("player_id", profileId).eq("status", "active");
    for (const l of (links ?? []) as Array<{ guardian_id: string; permissions: Record<string, boolean> }>) if (l.permissions.add_rewards) await admin.from("notifications").insert({ profile_id: profileId, type: "reward_earned_guardian", payload: { reward_id: r.id, title: r.title, guardian_id: l.guardian_id } });
  }
  for (const a of (custom ?? []) as Array<{ id: string; code: string; trigger_type: TriggerType | null; trigger_params: Record<string, unknown>; created_at: string }>) {
    if (!a.trigger_type) continue;
    const facts = await factsSince(a.created_at);
    if (!triggerSatisfied(a.trigger_type, a.trigger_params, facts)) continue;
    const { data } = await admin.from("profile_achievements").upsert({ profile_id: profileId, achievement_id: a.id, tier: 1, source_key: "", source_id: null }, { onConflict: "profile_id,achievement_id,tier,source_key", ignoreDuplicates: true }).select("achievement_id");
    if (data?.length) achievements.push(a.code);
  }
  return { earned, achievements };
}
