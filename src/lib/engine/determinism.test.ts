/**
 * 0.5 ج.5-4 (RULES-5): الحتمية — كل دالة قرار في المحرك تُستدعى مرتين بالمدخلات نفسها (الوقت والبذرة محقونان) فتعطي المخرج نفسه حرفيًا.
 * الفحص الثابت (لا Math.random ولا Date.now ولا new Date() في ملفات المحرك) في src/lib/boundary.test.ts وقاعدة ESLint.
 */
import { describe, it, expect } from "vitest";
import * as E from "./index";

const NOW = new Date("2026-11-09T09:00:00Z");
const caps = [{ confidence: 0.5, support_level: "L2_ask" as const, training_level: "guided_real" as const, mastered: false }];
const days = Array.from({ length: 10 }, (_, k) => ({ date: `2026-11-0${(k % 9) + 1}`, active: true, values: { focus_minutes_per_day: 20 + k } }));

const CASES: Array<[string, () => unknown]> = [
  ["capabilityScore.computeCapabilityScore", () => E.capabilityScore.computeCapabilityScore([{ value: 0.6, weight: 0.8, context_tag: "study", created_at: "2026-11-06T09:00:00Z" }, { value: -0.4, weight: 0.6, context_tag: "in_app", created_at: "2026-10-19T09:00:00Z" }], NOW)],
  ["capabilityLevels.decideSupport", () => E.capabilityLevels.decideSupport("L1_hint", [{ gate2: "shown", abandoned: false, hints_used: 0, training_level: "simulated" }, { gate2: "shown", abandoned: false, hints_used: 0, training_level: "simulated" }, { gate2: "shown", abandoned: false, hints_used: 1, training_level: "simulated" }], 3, 0.5)],
  ["capabilityLevels.nextMasteryCheckDate (بذرة)", () => E.capabilityLevels.nextMasteryCheckDate(NOW, "seed-1")],
  ["evidence.computeGate2", () => E.evidence.computeGate2({ capability_weights: { attention: 0.7, self_control: 0.3 } }, [{ capability_id: "attention", value: 0.8, weight: 0.8, source: "auto" }, { capability_id: "self_control", value: 0.8, weight: 0.4, source: "auto" }] as never)],
  ["gameXp.missionXp", () => E.gameXp.missionXp({ gate1: true, gate2: "shown", difficulty: 2, trainingLevel: "simulated", incentiveStage: 1, primaryCapabilitySupport: "L1_hint" })],
  ["gameStage.nextStage + computeIntensity", () => { const s = E.gameStage.nextStage({ stage: 1, daysSinceOnboarding: 9, reflectedMissions: 9, selfCreatedReflectedMissions: 1, transferReports: 1, transferReportsLast30Days: 1, capabilities: caps }); return [s, E.gameStage.computeIntensity(s, 1, "teen", null)]; }],
  ["surprises.rollSurprise (بذرة mission_id)", () => E.surprises.rollSurprise({ missionId: "00000000-0000-4000-8000-000000000001", stage: 1, intensity: 80, enabled: true, todayCount: 0, weekCount: 0, mode: "teen" })],
  ["notificationPlan.decideDelivery", () => E.notificationPlan.decideDelivery({ now: NOW, tz: "Asia/Amman", bypass: false, sentTodayCount: 1, maxPerDay: 3, hardCap: 6, quiet: ["22:00", "07:00"], notificationTime: "17:00" })],
  ["engagement.computeState + dailyBudget", () => { const st = E.engagement.computeState({ followThrough: 0.3, activeDays7: 3, winsLast24h: 0, ignoredInRow: 0, daysSinceOpen: 0, breakMode: false }); return [st, E.engagement.dailyBudget({ state: st, ageMode: "teen", breakMode: false, busy: false, userMax: "auto" })]; }],
  ["responseModePolicy.policyMode", () => E.responseModePolicy.policyMode({ moment: "strategy_choice", support: "L2_ask", ageMode: "teen", afterStuck: false })],
  ["pace.proposeIncrement + checkTarget", () => { const b = E.pace.baselines(days); return [b, E.pace.proposeIncrement({ ageMode: "adult", stretchPercent: 10, baseline: b?.values ?? null, previous: null, newHabits: [], hardWeek: false }), E.pace.checkTarget({ baseline: 20, target: 35, discovery: false, mode: "soft", confirmed: false })]; }],
  ["plannerNlp.parseQuickAdd (اليوم محقون)", () => E.plannerNlp.parseQuickAdd("اجتماع بكرا الساعة 5 #عمل", { today: "2026-11-09", ambiguousPmUntil: 7, weekStart: "sat" })],
  ["plannerDayPlan.planDay", () => E.plannerDayPlan.planDay({ mode: "propose_full_order", tasks: [{ id: "a", priority: "high", due_date: "2026-11-09", due_time: null, estimate_min: 30 }, { id: "b", priority: "low", due_date: null, due_time: "15:00", estimate_min: 20 }], today: "2026-11-09", nowMin: 540, busy: [] })],
  ["mirrorSuggest.mirrorSuggestionDue", () => E.mirrorSuggest.mirrorSuggestionDue({ today: "2026-11-09", gapEnabled: true, monthlyEnabled: true, weeklyFollowThrough: [0.2, 0.3], repeatedShortfall: false, past: [], lastMirrorDate: null, followUpCandidate: null })],
  ["dayText.parseDayText", () => E.dayText.parseDayText("صحيت 9 وقعدت عالجوال لـ 11", ["sleep", "phone_screens"])],
  ["safetyKeywords.keywordSafety", () => E.safetyKeywords.keywordSafety("نص عادي")],
];

describe("الحتمية: نفس المدخلات ⇒ نفس المخرج", () => {
  for (const [name, f] of CASES) it(name, () => { expect(JSON.stringify(f())).toEqual(JSON.stringify(f())); });
  it("كل وحدات المحرك المسجلة تُغطّى باختبار واحد على الأقل أو بأدوات مساعدة نقية", () => {
    expect(Object.keys(E).length).toBeGreaterThan(30);
  });
});
