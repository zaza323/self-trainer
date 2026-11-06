import { game } from "@/shared/config";

/**
 * تعديل 0.3 §2: نقاط التحدي — منفصلة عن XP، من الأدلة فقط، على مهام قالب التحدي داخل نافذته. دوال نقية.
 *   attempts_pts    = 4 × مهام reflected (حد 2 يوميًا، 10 إجمالًا)
 *   shown_pts       = 12 × shown + 4 × partial
 *   transfer_pts    = 15 × نقل مؤكد من مربٍ + 7 × نقل ذاتي (حد 4)
 *   improvement_pts = clamp(round(2 × (score_end − score_start)), 0, 30)
 */
export type ParticipantInput = {
  profile_id: string;
  score_start: number;
  score_end: number;
  missions: Array<{ day: string; gate2: "shown" | "partial" | "not_yet" | null }>; // المهام reflected داخل النافذة بيوم إكمالها
  transfers: Array<{ guardian_confirmed: boolean }>;
};
export type ParticipantScore = { profile_id: string; attempts_pts: number; shown_pts: number; transfer_pts: number; improvement_pts: number; total: number; rank: number; badges: string[]; reflected_count: number };

export function scoreParticipant(p: ParticipantInput): Omit<ParticipantScore, "rank" | "badges"> {
  const c = game.challenges.scoring;
  const perDay = new Map<string, number>();
  let counted = 0;
  for (const m of [...p.missions].sort((a, b) => a.day.localeCompare(b.day))) {
    const d = perDay.get(m.day) ?? 0;
    if (d >= c.attempts_daily_cap || counted >= c.attempts_total_cap) continue;
    perDay.set(m.day, d + 1); counted++;
  }
  const attempts_pts = c.attempts_per_reflected * counted;
  const shown_pts = c.shown * p.missions.filter((m) => m.gate2 === "shown").length + c.partial * p.missions.filter((m) => m.gate2 === "partial").length;
  const tr = p.transfers.slice(0, c.transfer_cap);
  const transfer_pts = tr.reduce((s, t) => s + (t.guardian_confirmed ? c.transfer_confirmed : c.transfer_self), 0);
  const improvement_pts = Math.max(0, Math.min(c.improvement_max, Math.round(c.improvement_factor * (p.score_end - p.score_start))));
  return { profile_id: p.profile_id, attempts_pts, shown_pts, transfer_pts, improvement_pts, total: attempts_pts + shown_pts + transfer_pts + improvement_pts, reflected_count: p.missions.length };
}

/** الترتيب (التعادل يتقاسم المرتبة) والأوسمة: أكبر تحسن، أكثر مثابرة. */
export function computeChallengeScores(participants: ParticipantInput[]): ParticipantScore[] {
  const scored = participants.map(scoreParticipant);
  const sorted = [...scored].sort((a, b) => b.total - a.total || a.profile_id.localeCompare(b.profile_id));
  const rankOf = new Map<string, number>();
  let rank = 0, prev: number | null = null;
  sorted.forEach((s, i) => { if (prev === null || s.total < prev) { rank = i + 1; prev = s.total; } rankOf.set(s.profile_id, rank); });
  const maxImprovement = Math.max(0, ...scored.map((s) => s.improvement_pts));
  const maxReflected = Math.max(0, ...scored.map((s) => s.reflected_count));
  return scored.map((s) => ({
    ...s, rank: rankOf.get(s.profile_id)!,
    badges: [
      ...(maxImprovement > 0 && s.improvement_pts === maxImprovement ? ["biggest_improvement"] : []),
      ...(maxReflected > 0 && s.reflected_count === maxReflected ? ["most_persistent"] : []),
    ],
  }));
}
