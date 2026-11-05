/** تعديل 0.3 — اختبارات القبول (القسم 6) على الدوال النقية: 1، 3، 4، 5. */
import { describe, it, expect } from "vitest";
import { stepXp, stepXpStopped } from "./step-xp";
import { rollSurprise, seededRng, hashSeed } from "./surprises";
import { missionXp } from "./xp";
import { computeChallengeScores, scoreParticipant } from "@/modules/challenges/scoring";
import { game } from "@/shared/config";

describe("§1 نقاط الخطوات", () => {
  const base = { missionId: "m1", planned: true, predicted: true, resumed: true, distractionsHandled: 3 };
  it("اختبار 1: قدرة دعمها L3 → صفر نقاط خطوات، ونقاط النتائج كما هي", () => {
    expect(stepXp({ ...base, primarySupport: "L3_free", primaryMastered: false })).toEqual([]);
    expect(stepXp({ ...base, primarySupport: "L1_hint", primaryMastered: true })).toEqual([]);
    const result = missionXp({ gate1: true, gate2: "shown", difficulty: 2, trainingLevel: "simulated", incentiveStage: 1, primaryCapabilitySupport: "L3_free" });
    expect(result.reduce((s, a) => s + a.amount, 0)).toBe(40); // المثال 1 بلا تغيير
  });
  it("قيد التدريب: 3 + 2 + 3 + 2×2 (حد المشتتات 2) بمصادر فريدة", () => {
    const a = stepXp({ ...base, primarySupport: "L1_hint", primaryMastered: false });
    const r = game.xp.step_rewards;
    expect(a.reduce((s, x) => s + x.amount, 0)).toBe(r.step_planned + r.step_prediction + r.step_resumed + r.step_distraction_handled.per_event * r.step_distraction_handled.max_per_mission);
    expect(a.map((x) => x.source_id)).toEqual(["m1", "m1", "m1", "m1:1", "m1:2"]);
    expect(stepXpStopped("L2_ask", false)).toBe(false);
  });
});

describe("§2 نقاط التحدي", () => {
  it("اختبار 3: 5 محاولات في يوم واحد → تُحتسب 2 فقط في attempts_pts", () => {
    const c = game.challenges.scoring;
    const s = scoreParticipant({ profile_id: "a", score_start: 50, score_end: 50, missions: Array(5).fill({ day: "2026-11-05", gate2: "not_yet" }), transfers: [] });
    expect(s.attempts_pts).toBe(c.attempts_per_reflected * c.attempts_daily_cap);
    expect(s.reflected_count).toBe(5);
    const many = scoreParticipant({ profile_id: "a", score_start: 50, score_end: 50, missions: Array(20).fill(0).map((_, i) => ({ day: `2026-11-${String(1 + i).padStart(2, "0")}`, gate2: null })), transfers: [] });
    expect(many.attempts_pts).toBe(c.attempts_per_reflected * c.attempts_total_cap);
  });
  it("shown/partial، النقل بحد 4، التحسن مقصوص 0..30، التعادل يتقاسم المرتبة، الأوسمة", () => {
    const c = game.challenges.scoring;
    const r = computeChallengeScores([
      { profile_id: "a", score_start: 40, score_end: 60, missions: [{ day: "d1", gate2: "shown" }, { day: "d2", gate2: "partial" }], transfers: [{ guardian_confirmed: true }, { guardian_confirmed: false }, { guardian_confirmed: false }, { guardian_confirmed: false }, { guardian_confirmed: false }] },
      { profile_id: "b", score_start: 50, score_end: 40, missions: [{ day: "d1", gate2: "shown" }, { day: "d2", gate2: "partial" }], transfers: [] },
      { profile_id: "c", score_start: 50, score_end: 40, missions: [{ day: "d1", gate2: "shown" }, { day: "d2", gate2: "partial" }], transfers: [] },
    ]);
    const a = r.find((x) => x.profile_id === "a")!, b = r.find((x) => x.profile_id === "b")!, cc = r.find((x) => x.profile_id === "c")!;
    expect(a.shown_pts).toBe(c.shown + c.partial);
    expect(a.transfer_pts).toBe(c.transfer_confirmed + 3 * c.transfer_self);
    expect(a.improvement_pts).toBe(Math.min(c.improvement_max, c.improvement_factor * 20));
    expect(b.improvement_pts).toBe(0);
    expect([a.rank, b.rank, cc.rank]).toEqual([1, 2, 2]);
    expect(a.badges).toEqual(expect.arrayContaining(["most_improved", "most_persistent"]));
    expect(b.badges).toEqual(["most_persistent"]);
  });
});

describe("§3 المفاجآت", () => {
  const base = { stage: 1, intensity: 50, enabled: true, todayCount: 0, weekCount: 0, mode: "teen" as const };
  it("اختبار 4: المولّد حتمي ببذرة mission_id → إعادة الحساب تعطي النتيجة نفسها حرفيًا", () => {
    const ids = Array(200).fill(0).map((_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const first = ids.map((missionId) => rollSurprise({ ...base, missionId }));
    const second = ids.map((missionId) => rollSurprise({ ...base, missionId }));
    expect(second).toEqual(first);
    const hits = first.filter(Boolean).length;
    expect(hits).toBeGreaterThan(0);
    expect(hits / ids.length).toBeLessThan(game.surprises.probability_by_stage["1"] * 3);
    expect(seededRng(hashSeed("x"))()).toBe(seededRng(hashSeed("x"))());
  });
  it("اختبار 5: مستخدم بالمرحلة 4 → لا مفاجآت", () => {
    for (let i = 0; i < 300; i++) expect(rollSurprise({ ...base, stage: 4, missionId: `m${i}` })).toBeNull();
  });
  it("الحدود: 1 يوميًا، 3 أسبوعيًا، لا تظهر تحت الكثافة الدنيا أو عند التعطيل؛ الأنواع ضمن النِّسب وXP ضمن المدى", () => {
    const hit = Array(500).fill(0).map((_, i) => `s${i}`).find((missionId) => rollSurprise({ ...base, missionId }))!;
    expect(rollSurprise({ ...base, missionId: hit, todayCount: game.surprises.daily_cap })).toBeNull();
    expect(rollSurprise({ ...base, missionId: hit, weekCount: game.surprises.weekly_cap })).toBeNull();
    expect(rollSurprise({ ...base, missionId: hit, intensity: game.surprises.min_intensity - 1 })).toBeNull();
    expect(rollSurprise({ ...base, missionId: hit, enabled: false })).toBeNull();
    const kinds = { cosmetic: 0, xp_bonus: 0, encouragement: 0 };
    for (let i = 0; i < 3000; i++) { const s = rollSurprise({ ...base, missionId: `k${i}` }); if (s) { kinds[s.kind]++; if (s.kind === "xp_bonus") { expect(s.payload.xp).toBeGreaterThanOrEqual(game.surprises.xp_bonus_range[0]); expect(s.payload.xp).toBeLessThanOrEqual(game.surprises.xp_bonus_range[1]); } } }
    const n = kinds.cosmetic + kinds.xp_bonus + kinds.encouragement;
    expect(kinds.cosmetic / n).toBeGreaterThan(0.35);
    expect(kinds.encouragement / n).toBeLessThan(0.35);
  });
});
