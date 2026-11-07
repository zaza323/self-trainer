import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { game, CAPABILITY_IDS, type AgeMode, type SupportLevel, type TrainingLevel } from "@/shared/config";
import { effective } from "@/modules/settings";
import { loadTemplate } from "@/modules/library";
import { nextStage, computeIntensity, avgSupport, visibleElements, type IncentiveStage, type GameElement } from "./stage";
import { avatarPoints, avatarStage, displayedAvatarStage } from "./avatar";
import { isComeback, comebackTierReached, isMindfulAbandon, newContextCapabilities, qualifiesPlayLess } from "./achievements";
import { levelForXp, applyDailyCap } from "./xp";
import { stepXp } from "./step-xp";
import { rollSurprise, type Surprise } from "./surprises";
import spaceContent from "@content/space.ar.json";
import { primaryCapability } from "@/modules/library";

type Admin = SupabaseClient;
const DAY = 86400000;

async function achievementId(admin: Admin, code: string): Promise<string | null> {
  const { data } = await admin.from("achievements").select("id").eq("code", code).is("owner_profile_id", null).maybeSingle();
  return (data?.id as string) ?? null;
}

export async function award(admin: Admin, profileId: string, code: string, tier: number, sourceKey = "", sourceId: string | null = null): Promise<boolean> {
  const id = await achievementId(admin, code);
  if (!id) return false;
  const { data } = await admin.from("profile_achievements").upsert({ profile_id: profileId, achievement_id: id, tier, source_key: sourceKey, source_id: sourceId }, { onConflict: "profile_id,achievement_id,tier,source_key", ignoreDuplicates: true }).select("achievement_id");
  return Boolean(data && (data as unknown[]).length);
}

export type GameReport = { comeback: boolean; achievements: string[]; collectible: boolean; stage: IncentiveStage; stage_changed: boolean; intensity: number; avatar_stage: number; step_xp: number; surprise: Surprise | null };

/** السقف اليومي (أ.8): مجموع ما مُنح اليوم (UTC كما في محرك الأدلة). */
async function xpToday(admin: Admin, profileId: string, now: Date): Promise<number> {
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const { data } = await admin.from("xp_events").select("amount").eq("profile_id", profileId).gte("created_at", dayStart.toISOString());
  return ((data ?? []) as Array<{ amount: number }>).reduce((s, x) => s + x.amount, 0);
}

/**
 * تعديل 0.3 §1: نقاط الخطوات عند reflected ما دامت القدرة الأساسية قيد التدريب (تتوقف عند L3_free أو الإتقان)، ضمن السقف اليومي، idempotent.
 */
export async function awardStepXp(admin: Admin, missionId: string, now = new Date()): Promise<number> {
  const { data: m } = await admin.from("missions").select("id, profile_id, template_id, template_version, status, strategy_chosen, custom_strategy, time_estimate, prediction, interruption_reasons, distraction_log").eq("id", missionId).single();
  if (!m) return 0;
  const mission = m as { id: string; profile_id: string; template_id: string; template_version: number; status: string; strategy_chosen: string | null; custom_strategy: string | null; time_estimate: number | null; prediction: unknown; interruption_reasons: unknown[]; distraction_log: Array<{ choice: string }> };
  if (mission.status !== "reflected" && mission.status !== "transferred") return 0;
  const t = await loadTemplate(admin, mission.template_id, mission.template_version);
  if (!t) return 0;
  const cap = primaryCapability(t);
  const { data: st } = await admin.from("capability_states").select("support_level, mastered").eq("profile_id", mission.profile_id).eq("capability_id", cap).maybeSingle();
  const state = st as { support_level: SupportLevel; mastered: boolean } | null;
  const awards = stepXp({
    missionId: mission.id,
    planned: Boolean((mission.strategy_chosen || mission.custom_strategy) && mission.time_estimate),
    predicted: mission.prediction !== null && mission.prediction !== undefined,
    resumed: (mission.interruption_reasons?.length ?? 0) > 0,
    distractionsHandled: (mission.distraction_log ?? []).filter((d) => d.choice === "ignore" || d.choice === "break_return").length,
    primarySupport: state?.support_level ?? "L0_instruct", primaryMastered: state?.mastered ?? false,
  });
  if (awards.length === 0) return 0;
  const capped = applyDailyCap(awards, await xpToday(admin, mission.profile_id, now));
  const rows = capped.map((a, i) => ({ profile_id: mission.profile_id, amount: a.amount, reason: a.reason, source_id: awards[i]!.source_id }));
  if (rows.length) await admin.from("xp_events").upsert(rows, { onConflict: "reason,source_id", ignoreDuplicates: true });
  return capped.reduce((s, a) => s + a.amount, 0);
}

/**
 * تعديل 0.3 §3: مفاجأة مجانية بعد reflected باحتمال حسب المرحلة؛ حتمية ببذرة mission_id؛ 1 يوميًا و3 أسبوعيًا؛ لا تظهر تحت الكثافة الدنيا أو إن عُطّلت.
 * UNIQUE(mission_id) + حتمية المولّد ⇒ إعادة الحساب تعطي النتيجة نفسها حرفيًا.
 */
export async function maybeSurprise(admin: Admin, mission: { id: string; profile_id: string }, profile: { age_mode: AgeMode; incentive_stage: number }, intensity: number, now = new Date()): Promise<Surprise | null> {
  const { data: existing } = await admin.from("surprise_events").select("kind, payload, rng_seed").eq("mission_id", mission.id).maybeSingle();
  if (existing) return existing as Surprise;
  const enabled = (await effective<boolean>(admin, mission.profile_id, "surprises_enabled")).value;
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart.getTime() - 6 * DAY);
  const { data: recent } = await admin.from("surprise_events").select("created_at").eq("profile_id", mission.profile_id).gte("created_at", weekStart.toISOString());
  const rows = (recent ?? []) as Array<{ created_at: string }>;
  const sp = rollSurprise({ missionId: mission.id, stage: profile.incentive_stage, intensity, enabled: Boolean(enabled), todayCount: rows.filter((r) => r.created_at >= dayStart.toISOString()).length, weekCount: rows.length, mode: profile.age_mode });
  if (!sp) return null;
  const { data: ins } = await admin.from("surprise_events").upsert({ profile_id: mission.profile_id, mission_id: mission.id, kind: sp.kind, payload: sp.payload, rng_seed: sp.rng_seed }, { onConflict: "mission_id", ignoreDuplicates: true }).select("id");
  if (!ins || (ins as unknown[]).length === 0) return sp; // سبق حسابها
  if (sp.kind === "xp_bonus" && sp.payload.xp) {
    const capped = applyDailyCap([{ reason: "surprise_bonus", amount: sp.payload.xp }], await xpToday(admin, mission.profile_id, now));
    if (capped.length) await admin.from("xp_events").upsert({ profile_id: mission.profile_id, amount: capped[0]!.amount, reason: "surprise_bonus", source_id: mission.id }, { onConflict: "reason,source_id", ignoreDuplicates: true });
  }
  return sp;
}

/** القدرات مع آخر ثقة (للمراحل والكثافة والمساحة). */
export async function capabilityView(admin: Admin, profileId: string) {
  const [{ data: st }, { data: snaps }] = await Promise.all([
    admin.from("capability_states").select("capability_id, support_level, training_level, mastered").eq("profile_id", profileId),
    admin.from("capability_snapshots").select("capability_id, confidence, date").eq("profile_id", profileId).order("date", { ascending: false }),
  ]);
  const conf = new Map<string, number>();
  for (const s of (snaps ?? []) as Array<{ capability_id: string; confidence: number }>) if (!conf.has(s.capability_id)) conf.set(s.capability_id, Number(s.confidence));
  return ((st ?? []) as Array<{ capability_id: string; support_level: SupportLevel; training_level: TrainingLevel; mastered: boolean }>).map((s) => ({ ...s, confidence: conf.get(s.capability_id) ?? 0 }));
}

/**
 * بعد كل reflected (يُستدعى بعد evaluateAndRecord): العودة بعد انقطاع (XP + إنجاز)، تخليتَ بوعي، سياق جديد،
 * عنصر تجميعي (المرحلة 1–2)، ثم المرحلة والكثافة والمساحة. كل الكتابات idempotent.
 */
export async function afterMissionReflected(admin: Admin, missionId: string, now = new Date()): Promise<GameReport> {
  const { data: m } = await admin.from("missions").select("id, profile_id, template_id, template_version, gate1, gate2, status, source").eq("id", missionId).single();
  if (!m) throw new Error("mission not found");
  const mission = m as { id: string; profile_id: string; template_id: string; template_version: number; gate1: boolean | null; gate2: string | null; status: string; source: string };
  const { data: p } = await admin.from("profiles").select("id, age_mode, incentive_stage, avatar_stage_max, onboarded_at, created_at").eq("id", mission.profile_id).single();
  const profile = p as { id: string; age_mode: AgeMode; incentive_stage: number; avatar_stage_max: number; onboarded_at: string | null; created_at: string };
  const achievements: string[] = [];

  // --- العودة بعد انقطاع (أ.8/أ.9) ---
  const { data: tr } = await admin.from("mission_transitions").select("to_status, at").eq("mission_id", mission.id).order("at", { ascending: true });
  const transitions = (tr ?? []) as Array<{ to_status: string; at: string }>;
  const resumedAt = transitions.find((t) => t.to_status === "chosen")?.at ?? transitions[0]?.at;
  const reflectedAt = transitions.find((t) => t.to_status === "reflected")?.at;
  let comeback = false;
  if (resumedAt && reflectedAt) {
    const { data: ids } = await admin.from("missions").select("id").eq("profile_id", mission.profile_id);
    const { data: prevRows } = await admin.from("mission_transitions").select("at").in("mission_id", ((ids ?? []) as Array<{ id: string }>).map((x) => x.id).filter((x) => x !== mission.id)).lt("at", resumedAt).order("at", { ascending: false }).limit(1);
    const prev = (prevRows ?? [])[0] as { at: string } | undefined;
    if (isComeback({ previousActivityAt: prev ? new Date(prev.at) : null, resumedAt: new Date(resumedAt), reflectedAt: new Date(reflectedAt) })) {
      comeback = true;
      await admin.from("xp_events").upsert({ profile_id: mission.profile_id, amount: game.xp.rewards.comeback, reason: "comeback", source_id: mission.id }, { onConflict: "reason,source_id", ignoreDuplicates: true });
      const { data: cb } = await admin.from("xp_events").select("id").eq("profile_id", mission.profile_id).eq("reason", "comeback");
      const tier = comebackTierReached((cb ?? []).length);
      if (tier && (await award(admin, mission.profile_id, "comeback", tier, "", mission.id))) achievements.push("comeback");
    }
  }

  // --- تخليتَ بوعي، طبقتَ في سياق جديد ---
  const { data: ev } = await admin.from("evidence_events").select("capability_id, type, value").eq("mission_id", mission.id);
  const evidence = ((ev ?? []) as Array<{ capability_id: string; type: string; value: number }>).map((e) => ({ ...e, value: Number(e.value) }));
  if (isMindfulAbandon({ gate1: Boolean(mission.gate1), reflected: true, evidence }) && (await award(admin, mission.profile_id, "mindful_abandon", 1, "", mission.id))) achievements.push("mindful_abandon");
  for (const cap of newContextCapabilities(evidence)) if (await award(admin, mission.profile_id, "new_context", 1, cap, mission.id)) achievements.push("new_context");

  // --- عنصر تجميعي (GAME-6): المرحلة 1–2 فقط وshown ---
  let collectible = false;
  const stageNow = profile.incentive_stage as IncentiveStage;
  if (mission.gate2 === "shown" && game.intensity.element_thresholds.collectibles_and_unlocks.allowed_stages.includes(stageNow)) {
    const t = await loadTemplate(admin, mission.template_id, mission.template_version);
    const icon = (spaceContent.collectible_by_mechanic as Record<string, string>)[t?.mechanic ?? ""] ?? "★";
    const { data } = await admin.from("collectibles").upsert({ profile_id: mission.profile_id, mission_id: mission.id, kind: t?.mechanic ?? "unknown", icon }, { onConflict: "mission_id", ignoreDuplicates: true }).select("id");
    collectible = Boolean(data && (data as unknown[]).length);
  }

  // --- تعديل 0.3: نقاط الخطوات أثناء التدريب ---
  const step_xp = await awardStepXp(admin, mission.id, now);
  const state = await refreshGameState(admin, profile, now);
  // --- تعديل 0.3: مفاجأة عشوائية حتمية ---
  const surprise = await maybeSurprise(admin, mission, { age_mode: profile.age_mode, incentive_stage: state.stage }, state.intensity, now);
  return { comeback, achievements, collectible, ...state, step_xp, surprise };
}

/** المرحلة (أ.7) والكثافة والمساحة (أ.8) — تُحدَّث على الملف للعرض السريع وللمربي. */
export async function refreshGameState(admin: Admin, profile: { id: string; age_mode: AgeMode; incentive_stage: number; avatar_stage_max: number; onboarded_at: string | null; created_at: string }, now = new Date()): Promise<{ stage: IncentiveStage; stage_changed: boolean; intensity: number; avatar_stage: number }> {
  const caps = await capabilityView(admin, profile.id);
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const [{ data: doneRows }, { data: trRows }, override] = await Promise.all([
    admin.from("missions").select("id, source").eq("profile_id", profile.id).in("status", ["reflected", "transferred"]),
    admin.from("transfer_reports").select("id, created_at").eq("profile_id", profile.id).eq("worked", true),
    effective<number | null>(admin, profile.id, "game_intensity_override"),
  ]);
  const done = (doneRows ?? []) as Array<{ id: string; source: string }>;
  const trs = (trRows ?? []) as Array<{ id: string; created_at: string }>;
  const reflected = done.length, selfReflected = done.filter((d) => d.source === "self").length;
  const transfers = trs.length, transfers30 = trs.filter((t) => t.created_at >= since30).length;
  const onboarded = new Date(profile.onboarded_at ?? profile.created_at);
  const stage = nextStage({
    stage: profile.incentive_stage as IncentiveStage,
    daysSinceOnboarding: (now.getTime() - onboarded.getTime()) / DAY,
    reflectedMissions: reflected, selfCreatedReflectedMissions: selfReflected,
    transferReports: transfers, transferReportsLast30Days: transfers30,
    capabilities: caps,
  });
  const intensity = computeIntensity(stage, avgSupport(caps), profile.age_mode, override.value);
  const avatar = displayedAvatarStage(avatarStage(avatarPoints(caps)), profile.avatar_stage_max);
  await admin.from("profiles").update({ incentive_stage: stage, game_intensity: intensity, avatar_stage_max: avatar }).eq("id", profile.id);
  return { stage, stage_changed: stage !== profile.incentive_stage, intensity, avatar_stage: avatar };
}

/** "تلعب أقل" (أ.9): يُقيَّم أسبوعيًا (هنا عند الطلب بشكل idempotent؛ الجدولة في المرحلة 6). */
export async function evaluatePlayLess(admin: Admin, profileId: string, now = new Date()): Promise<boolean> {
  const r = game.achievements.play_less;
  const { data: p } = await admin.from("profiles").select("incentive_stage").eq("id", profileId).single();
  const stage = (p?.incentive_stage as number) ?? 1;
  if (stage < r.min_stage) return false;
  const w = r.window_days * DAY;
  const start1 = new Date(now.getTime() - w), start0 = new Date(now.getTime() - 2 * w);
  const { data: mids } = await admin.from("missions").select("id").eq("profile_id", profileId);
  const { data: acts } = await admin.from("mission_transitions").select("at").in("mission_id", ((mids ?? []) as Array<{ id: string }>).map((x) => x.id)).gte("at", start0.toISOString());
  const days = (from: Date, to: Date) => new Set(((acts ?? []) as Array<{ at: string }>).filter((a) => { const t = new Date(a.at).getTime(); return t >= from.getTime() && t < to.getTime(); }).map((a) => a.at.slice(0, 10))).size;
  const { data: workedRows } = await admin.from("transfer_reports").select("id").eq("profile_id", profileId).eq("worked", true).gte("created_at", start1.toISOString());
  const worked = (workedRows ?? []).length;
  const { data: snaps } = await admin.from("capability_snapshots").select("capability_id, score, confidence, date").eq("profile_id", profileId).gte("date", start1.toISOString().slice(0, 10)).order("date", { ascending: true });
  const deltas = CAPABILITY_IDS.map((cap) => {
    const mine = ((snaps ?? []) as Array<{ capability_id: string; score: number; confidence: number }>).filter((s) => s.capability_id === cap);
    if (mine.length === 0) return { start: 50, end: 50, active: false };
    const first = mine[0]!, last = mine[mine.length - 1]!;
    return { start: Number(first.score), end: Number(last.score), active: Number(last.confidence) >= game.incentive_stages.active_capability_min_confidence };
  });
  const { data: checks } = await admin.from("missions").select("gate2").eq("profile_id", profileId).eq("is_mastery_check", true).in("status", ["reflected", "transferred"]).gte("completed_at", start1.toISOString());
  const q = qualifiesPlayLess({ stage, activeDaysLast28: days(start1, now), activeDaysPrev28: days(start0, start1), workedTransferReportsLast28: worked, capabilityDeltas: deltas, masteryChecksInWindow: ((checks ?? []) as Array<{ gate2: string }>).map((c) => ({ passed: c.gate2 === "shown" })) });
  if (!q.ok) return false;
  return award(admin, profileId, "play_less", 1, "", null);
}

export type GameView = {
  stage: IncentiveStage;
  intensity: number;
  visible: Set<GameElement>;
  xp: number;
  level: number;
  nextLevelXp: number;
  avatarStage: number;
  theme: string;
  themeName: string;
  stageName: string;
  achievements: Array<{ code: string; name: string; description: string; icon: string; tier: number; earned_at: string; source_id: string | null }>;
  collectibles: Array<{ icon: string; kind: string; earned_at: string }>;
  surprises: Array<{ kind: string; payload: { icon?: string; xp?: number; text?: string }; created_at: string }>;
};

/** نموذج القراءة للشاشات (يُحسب بعميل المستخدم عبر RLS). */
export async function getGameView(db: SupabaseClient, profile: { id: string; age_mode: AgeMode; incentive_stage: number; avatar_stage_max: number }): Promise<GameView> {
  const [caps, theme, override, { data: xp }, { data: pa }, { data: col }] = await Promise.all([
    capabilityView(db, profile.id),
    effective<string>(db, profile.id, "space_theme"),
    effective<number | null>(db, profile.id, "game_intensity_override"),
    db.from("xp_events").select("amount").eq("profile_id", profile.id),
    db.from("profile_achievements").select("achievement_id, tier, earned_at, source_id").eq("profile_id", profile.id).order("earned_at", { ascending: false }),
    db.from("collectibles").select("icon, kind, earned_at").eq("profile_id", profile.id).order("earned_at", { ascending: false }),
  ]);
  const { data: sur } = await db.from("surprise_events").select("kind, payload, created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(30);
  const stage = profile.incentive_stage as IncentiveStage;
  const intensity = computeIntensity(stage, avgSupport(caps), profile.age_mode, override.value);
  const total = ((xp ?? []) as Array<{ amount: number }>).reduce((s, x) => s + x.amount, 0);
  const level = levelForXp(total);
  const avatar = displayedAvatarStage(avatarStage(avatarPoints(caps)), profile.avatar_stage_max);
  const { data: achRows } = await db.from("achievements").select("id, code, name_by_mode, description_by_mode, icon");
  const achById = new Map(((achRows ?? []) as Array<{ id: string; code: string; name_by_mode: Record<string, string>; description_by_mode: Record<string, string>; icon: string }>).map((a) => [a.id, a]));
  const themes = spaceContent.themes as Record<string, { name: string; stages: string[] }>;
  const th = themes[theme.value] ?? themes.room!;
  return {
    stage, intensity, visible: visibleElements(intensity, stage), xp: total, level, nextLevelXp: 50 * (level + 1) * (level + 2), avatarStage: avatar,
    theme: theme.value, themeName: th.name, stageName: th.stages[avatar - 1] ?? "",
    achievements: ((pa ?? []) as Array<{ achievement_id: string; tier: number; earned_at: string; source_id: string | null }>).flatMap((r) => {
      const a = achById.get(r.achievement_id);
      if (!a) return [];
      return [{ code: a.code, name: a.name_by_mode[profile.age_mode] ?? a.code, description: a.description_by_mode?.[profile.age_mode] ?? "", icon: a.icon, tier: r.tier, earned_at: r.earned_at, source_id: r.source_id }];
    }),
    collectibles: (col ?? []) as Array<{ icon: string; kind: string; earned_at: string }>,
    surprises: (sur ?? []) as GameView["surprises"],
  };
}
