import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effective } from "@/modules/settings";
import { loadActiveTemplates, primaryCapability } from "@/modules/library";
import { todayIn } from "@/modules/missions/queries";
import { effectiveSupport } from "@/modules/capabilities";
import type { ProfileRow } from "@/shared/db/types";
import { customization, type AgeMode, type CapabilityId, type SupportLevel, type TrainingLevel } from "@/shared/config";
import { selectSuggestions, type HistoryItem, type CapabilityStateLite, type Suggestion } from "./select";
import { aiEnabled, anthropicCaller, selectWithAi } from "@/modules/companion";
import { createAdminClient } from "@/shared/db/admin";
import { nearestActiveGoal } from "@/modules/goals";
import { materializeSchedules } from "@/modules/life";

/** ENGINE-1: يضمن 1–3 مهام مقترحة لليوم. حتمي وبالقواعد فقط، ويقرأ capability_states وآخر لقطة. */
export async function ensureDailySuggestions(db: SupabaseClient, profile: ProfileRow): Promise<number> {
  const ageMode = profile.age_mode as AgeMode;
  const today = todayIn(profile.timezone);
  // MIS-10: المهام المتكررة المستحقة اليوم تُدرج أولًا وتُحتسب ضمن العدد اليومي
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  await materializeSchedules(db, profile.id, today, weekday);
  const [count, focus, breakMode, templates, { data: history }, { data: statesRows }, { data: snaps }] = await Promise.all([
    effective<number>(db, profile.id, "daily_mission_count"),
    effective<CapabilityId[]>(db, profile.id, "focus_capabilities"),
    effective<boolean>(db, profile.id, "break_mode"),
    loadActiveTemplates(db),
    db.from("missions").select("template_id, template_version, status, gate1, gate2, hints_used, difficulty, suggested_for, dismissed, is_mastery_check").eq("profile_id", profile.id).order("created_at", { ascending: false }),
    db.from("capability_states").select("*").eq("profile_id", profile.id),
    db.from("capability_snapshots").select("capability_id, score, confidence, date").eq("profile_id", profile.id).order("date", { ascending: false }),
  ]);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const hist: HistoryItem[] = ((history ?? []) as Array<{ template_id: string; status: string; gate1: boolean | null; gate2: HistoryItem["gate2"]; hints_used: number; difficulty: number; suggested_for: string; dismissed: boolean; is_mastery_check: boolean }>).flatMap((h) => {
    const t = byId.get(h.template_id);
    if (!t) return [];
    return [{ template_id: h.template_id, mechanic: t.mechanic, primary_capability: primaryCapability(t), training_level: t.training_level, status: h.status, gate1: h.gate1, gate2: h.gate2, hints_used: h.hints_used, difficulty: h.difficulty, suggested_for: h.suggested_for, dismissed: h.dismissed, is_mastery_check: h.is_mastery_check }];
  });
  const latestSnap = new Map<string, { score: number; confidence: number }>();
  for (const s of (snaps ?? []) as Array<{ capability_id: string; score: number; confidence: number }>) if (!latestSnap.has(s.capability_id)) latestSnap.set(s.capability_id, { score: Number(s.score), confidence: Number(s.confidence) });
  const now = new Date();
  const states: CapabilityStateLite[] = ((statesRows ?? []) as Array<{ capability_id: string; training_level: TrainingLevel; support_level: SupportLevel; mastered: boolean; next_mastery_check_at: string | null; support_temp_override: { level: SupportLevel; until: string } | null }>).map((s) => ({
    capability_id: s.capability_id, training_level: s.training_level, support_level: effectiveSupport(s.support_level, s.support_temp_override, now), mastered: s.mastered, next_mastery_check_at: s.next_mastery_check_at,
    score: latestSnap.get(s.capability_id)?.score, confidence: latestSnap.get(s.capability_id)?.confidence,
  }));
  // 7.6: «جرّب ميكانيكية» المقبول خلال engine_hint_days
  const hintDays = customization.adaptation.allowed_types.try_mechanic?.engine_hint_days ?? 0;
  const { data: hints } = await db.from("adaptation_suggestions").select("proposed_value, decided_at").eq("profile_id", profile.id).eq("type", "try_mechanic").eq("decision", "accepted").gte("decided_at", new Date(now.getTime() - hintDays * 86400000).toISOString()).order("decided_at", { ascending: false }).limit(1);
  const mechanicHint = ((hints ?? [])[0] as { proposed_value?: { mechanic?: string } } | undefined)?.proposed_value?.mechanic ?? null;
  const rules = selectSuggestions({ ageMode, today, templates, history: hist, states, focusCapabilities: focus.value, dailyCount: count.value, breakMode: breakMode.value, mechanicHint });
  if (rules.length === 0) return 0;
  // ENGINE-2: الذكاء الاصطناعي يختار من مرشحين يبنيها الخادم ويملأ المتغيرات؛ السقوط = أعلى مرشح بالقواعد (ENGINE-6)
  let suggestions: Suggestion[] = rules;
  if (aiEnabled()) {
    try {
      const pool = selectSuggestions({ ageMode, today, templates, history: hist, states, focusCapabilities: focus.value, dailyCount: Math.min(rules.length * 2, 6), breakMode: breakMode.value, mechanicHint });
      const { data: goals } = await db.from("goals").select("*").eq("profile_id", profile.id);
      const goalTitle = nearestActiveGoal((goals ?? []) as Array<{ id: string; parent_goal_id: string | null; title: string; why: string | null; status: "active" | "completed" | "archived"; created_at: string }>)?.title ?? null;
      const { data: pc } = await db.from("personal_context").select("interests, routine, free_windows, contexts").eq("profile_id", profile.id).maybeSingle();
      const admin = createAdminClient(); const caller = anthropicCaller();
      const picked: Suggestion[] = [];
      for (let i = 0; i < rules.length; i++) {
        const remaining = pool.filter((c) => !picked.some((p) => p.template.id === c.template.id));
        if (remaining.length === 0) break;
        const r = await selectWithAi({ db: admin, caller, profileId: profile.id, mode: ageMode, candidates: remaining, personalContext: (pc as Record<string, unknown> | null) ?? null, goalTitle });
        picked.push(r.suggestion);
      }
      if (picked.length) suggestions = picked;
    } catch (e) { console.error("mission_selector fallback", e); }
  }
  const { error } = await db.from("missions").insert(
    suggestions.map((s) => ({ profile_id: profile.id, template_id: s.template.id, template_version: s.template.version, status: "suggested", difficulty: s.difficulty, support_level: s.support_level, variables: s.variables, source: "engine", suggested_for: today, is_mastery_check: s.is_mastery_check })),
  );
  if (error) throw error;
  return suggestions.length;
}
