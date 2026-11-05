import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { game, type AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { computeChallengeScores, type ParticipantInput } from "./scoring";

export type ChallengeRow = { id: string; template_id: string; template_version: number; difficulty: number; capability_id: string; training_level: string; age_mode: AgeMode; starts_at: string; ends_at: string; join_until: string; status: "open" | "active" | "finished" | "cancelled"; created_by: string; invite_code: string; created_at: string };
export type ParticipantRow = { challenge_id: string; profile_id: string; display_name: string; support_level_at_join: string; score_start: number; joined_at: string; left_at: string | null; approved_by_guardian_id: string | null; requires_approval: boolean };
export const isMember = (p: ParticipantRow) => !p.left_at && (!p.requires_approval || p.approved_by_guardian_id !== null);

/** إعادة حساب نقاط تحدٍّ من الأدلة (idempotent). */
export async function recomputeChallengeScores(admin: SupabaseClient, challengeId: string, now = new Date()): Promise<number> {
  const { data: c } = await admin.from("challenges").select("*").eq("id", challengeId).maybeSingle();
  if (!c) return 0;
  const ch = c as ChallengeRow;
  const { data: parts } = await admin.from("challenge_participants").select("*").eq("challenge_id", challengeId);
  const members = ((parts ?? []) as ParticipantRow[]).filter(isMember);
  if (members.length === 0) return 0;
  const windowEnd = new Date(Math.min(now.getTime(), Date.parse(ch.ends_at))).toISOString();
  const inputs: ParticipantInput[] = [];
  for (const m of members) {
    const { data: ms } = await admin.from("missions").select("id, gate2, completed_at").eq("profile_id", m.profile_id).eq("template_id", ch.template_id).in("status", ["reflected", "transferred"]).gte("completed_at", ch.starts_at).lte("completed_at", windowEnd);
    const missions = (ms ?? []) as Array<{ id: string; gate2: ParticipantInput["missions"][number]["gate2"]; completed_at: string }>;
    const ids = missions.map((x) => x.id);
    const { data: tr } = ids.length ? await admin.from("transfer_reports").select("guardian_confirmed, created_at").eq("profile_id", m.profile_id).in("mission_id", ids).lte("created_at", windowEnd) : { data: [] };
    const { data: snap } = await admin.from("capability_snapshots").select("score").eq("profile_id", m.profile_id).eq("capability_id", ch.capability_id).lte("date", windowEnd.slice(0, 10)).order("date", { ascending: false }).limit(1);
    const scoreEnd = Number(((snap ?? [])[0] as { score?: number } | undefined)?.score ?? m.score_start);
    inputs.push({ profile_id: m.profile_id, score_start: m.score_start, score_end: scoreEnd, missions: missions.map((x) => ({ day: x.completed_at.slice(0, 10), gate2: x.gate2 })), transfers: (tr ?? []) as Array<{ guardian_confirmed: boolean }> });
  }
  const scores = computeChallengeScores(inputs);
  await admin.from("challenge_scores").upsert(scores.map((s) => ({ challenge_id: challengeId, ...s, computed_at: now.toISOString() })), { onConflict: "challenge_id,profile_id" });
  return scores.length;
}

/** الدورة: إنهاء التحديات المنتهية (وإلغاء ما لم يكتمل في نافذته)، وإعادة حساب الجارية. */
export async function tickChallenges(admin: SupabaseClient, now = new Date()): Promise<{ finished: number; cancelled: number; recomputed: number }> {
  const { data: rows } = await admin.from("challenges").select("*").in("status", ["open", "active"]);
  let finished = 0, cancelled = 0, recomputed = 0;
  for (const c of (rows ?? []) as ChallengeRow[]) {
    const { data: parts } = await admin.from("challenge_participants").select("*").eq("challenge_id", c.id);
    const members = ((parts ?? []) as ParticipantRow[]).filter(isMember).length;
    if (c.status === "open" && Date.parse(c.join_until) < now.getTime() && members < game.challenges.min_participants) {
      await admin.from("challenges").update({ status: "cancelled" }).eq("id", c.id); cancelled++; continue;
    }
    await recomputeChallengeScores(admin, c.id, now); recomputed++;
    if (Date.parse(c.ends_at) <= now.getTime()) { await admin.from("challenges").update({ status: "finished" }).eq("id", c.id); finished++; }
  }
  return { finished, cancelled, recomputed };
}

/** هل تظهر التحديات لهذا المتدرب؟ (الكثافة ≥ min_intensity والإعداد مفعّل) */
export async function challengesVisible(db: SupabaseClient, profile: { id: string; game_intensity: number | null }): Promise<boolean> {
  const enabled = (await effective<boolean>(db, profile.id, "challenges_enabled")).value;
  return Boolean(enabled) && (profile.game_intensity ?? 0) >= game.challenges.min_intensity;
}

/**
 * المطابقة التلقائية (teen وadult ولمن فعّلها): أول تحدٍّ مفتوح يجتاز فحص التكافؤ؛ وإلا يُنشأ تحدٍّ جديد على قالب آخر مهمة متأمَّل فيها.
 * يعمل بعميل المستخدم (RLS + RPC).
 */
export async function autoMatch(db: SupabaseClient, profile: { id: string; age_mode: AgeMode }): Promise<{ ok: true; challengeId: string; created: boolean } | { ok: false; error: string }> {
  if (!game.challenges.auto_match_age_modes.includes(profile.age_mode)) return { ok: false, error: "age_mode" };
  if (!(await effective<boolean>(db, profile.id, "challenge_auto_match")).value) return { ok: false, error: "auto_match_off" };
  // المرشحون: تحديات مفتوحة في نافذتها لا يشارك فيها (الرؤية عبر RLS محدودة؛ المطابقة تعتمد على الفحص في الخادم)
  const { data: open } = await db.from("challenges").select("id").eq("status", "open").eq("age_mode", profile.age_mode).gte("join_until", new Date().toISOString()).order("created_at", { ascending: true }).limit(20);
  for (const c of (open ?? []) as Array<{ id: string }>) {
    const { data: reason } = await db.rpc("challenge_fairness_check", { p_challenge: c.id, p_profile: profile.id });
    if (reason === null) {
      const { error } = await db.rpc("join_challenge", { p_profile_id: profile.id, p_challenge: c.id });
      if (!error) return { ok: true, challengeId: c.id, created: false };
    }
  }
  const { data: last } = await db.from("missions").select("template_id, template_version").eq("profile_id", profile.id).in("status", ["reflected", "transferred"]).order("completed_at", { ascending: false }).limit(1);
  const t = ((last ?? [])[0] as { template_id: string; template_version: number } | undefined);
  if (!t) return { ok: false, error: "no_template" };
  const { data: id, error } = await db.rpc("create_challenge", { p_profile_id: profile.id, p_template_id: t.template_id, p_version: t.template_version });
  if (error) return { ok: false, error: error.message };
  return { ok: true, challengeId: id as string, created: true };
}
