import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAPABILITY_IDS, scoring, type AgeMode, type CapabilityId, type SupportLevel, type TrainingLevel } from "@/shared/config";
import { effective } from "@/modules/settings";
import { computeCapabilityScore, confidenceBand, scoreBand, isDecline, effectiveSupport } from "./index";
import phrases from "@content/phrases.ar.json";
import capabilities from "@content/capabilities.ar.json";

export type MapItem = {
  id: CapabilityId;
  name: string;
  description: string;
  score: number;
  confidence: number;
  confidenceBand: "unknown" | "tentative" | "full";
  scoreBand: "needs_support" | "growing" | "strong";
  phrase: string;
  training_level: TrainingLevel | "mastered";
  support_level: SupportLevel;
  focused: boolean;
  trajectory: Array<{ date: string; score: number; confidence: number }>;
  decline: { message: string; question: string } | null;
  evidence_count: number;
};

export type MapView = { items: MapItem[]; intro: string; insights: { text: string; edited: boolean }; insightsDefault: string };

/** MAP-1..4: يُحسب حيًا من الأدلة (قابلة للقراءة عبر RLS) + المسار من اللقطات المخزنة. */
export async function buildMapView(db: SupabaseClient, profileId: string, mode: AgeMode, now = new Date()): Promise<MapView> {
  const lookbackDate = new Date(now.getTime() - scoring.display.decline.lookback_days * 86400000).toISOString().slice(0, 10);
  const [{ data: ev }, { data: st }, { data: snaps }, focus, { data: insights }, { data: refl }] = await Promise.all([
    db.from("evidence_events").select("capability_id, value, weight, context_tag, created_at").eq("profile_id", profileId),
    db.from("capability_states").select("*").eq("profile_id", profileId),
    db.from("capability_snapshots").select("capability_id, date, score, confidence").eq("profile_id", profileId).order("date", { ascending: true }),
    effective<CapabilityId[]>(db, profileId, "focus_capabilities"),
    db.from("self_insights").select("text, edited_by_user").eq("profile_id", profileId).maybeSingle(),
    db.from("reflections").select("prompts_and_answers, created_at, missions!inner(profile_id)").eq("missions.profile_id", profileId).order("created_at", { ascending: false }).limit(3),
  ]);
  const events = ((ev ?? []) as Array<{ capability_id: string; value: number; weight: number; context_tag: string; created_at: string }>).map((e) => ({ ...e, value: Number(e.value), weight: Number(e.weight) }));
  const states = new Map(((st ?? []) as Array<Record<string, unknown>>).map((s) => [s.capability_id as string, s]));
  const snapshots = (snaps ?? []) as Array<{ capability_id: string; date: string; score: number; confidence: number }>;
  const focused = new Set<string>(focus.value);
  const P = phrases as unknown as { phrases: Record<string, Record<string, Record<AgeMode, string>>>; unknown_yet: Record<AgeMode, string>; tentative_suffix: Record<AgeMode, string>; decline: { message: Record<AgeMode, string>; question: Record<AgeMode, string> }; self_insights_default: Record<AgeMode, string>; map_intro: Record<AgeMode, string> };

  const items: MapItem[] = CAPABILITY_IDS.map((id) => {
    const s = computeCapabilityScore(events.filter((e) => e.capability_id === id), now);
    const cb = confidenceBand(s.confidence), sb = scoreBand(s.score);
    const state = states.get(id);
    const traj = snapshots.filter((x) => x.capability_id === id).map((x) => ({ date: x.date, score: Number(x.score), confidence: Number(x.confidence) }));
    const past = [...traj].reverse().find((x) => x.date <= lookbackDate) ?? null;
    const phrase = cb === "unknown" ? P.unknown_yet[mode] : `${P.phrases[id]![sb]![mode]}${cb === "tentative" ? ` — ${P.tentative_suffix[mode]}` : ""}`;
    const c = (capabilities as unknown as Record<string, { name: string; description: string }>)[id]!;
    return {
      id, name: c.name, description: c.description, score: s.score, confidence: s.confidence, confidenceBand: cb, scoreBand: sb, phrase,
      training_level: state?.mastered ? "mastered" : ((state?.training_level as TrainingLevel) ?? "simulated"),
      support_level: effectiveSupport((state?.support_level as SupportLevel) ?? "L1_hint", (state?.support_temp_override as { level: SupportLevel; until: string } | null) ?? null, now),
      focused: focused.has(id), trajectory: traj,
      decline: isDecline({ score: s.score, confidence: s.confidence }, past) ? { message: P.decline.message[mode], question: P.decline.question[mode] } : null,
      evidence_count: events.filter((e) => e.capability_id === id).length,
    };
  });
  const generated = ((refl ?? []) as Array<{ prompts_and_answers: Array<{ prompt: string; answer: string }> }>).map((r) => r.prompts_and_answers[0]?.answer).filter(Boolean).join(" · ");
  return {
    items, intro: P.map_intro[mode],
    insights: { text: (insights?.text as string) || generated, edited: Boolean(insights?.edited_by_user) },
    insightsDefault: P.self_insights_default[mode],
  };
}
