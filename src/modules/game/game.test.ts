/** أ.11 اختبار 6 (كثافة 0 تُخفي كل عنصر) و9 (من ترك التطبيق لا يحصل على "تلعب أقل") + أ.7 وأ.8 وأ.9 */
import { describe, it, expect } from "vitest";
import { nextStage, computeIntensity, visibleElements, avgSupport, GAME_ELEMENTS } from "./stage";
import { avatarPoints, avatarStage, displayedAvatarStage } from "./avatar";
import { isComeback, comebackTierReached, isMindfulAbandon, newContextCapabilities, qualifiesPlayLess } from "./achievements";
import { levelForXp } from "./xp";

describe("أ.11 اختبار 6 — كثافة 0 → لا يُعرض أي عنصر من جدول أ.7", () => {
  it("لكل مرحلة", () => {
    for (const stage of [1, 2, 3, 4] as const) expect(visibleElements(0, stage).size).toBe(0);
  });
  it("العتبات: 10 المساحة والشارات والاحتفال الخفيف، 30 XP، 40 الاحتفال الكامل، 60 العناصر التجميعية في 1–2 فقط", () => {
    expect([...visibleElements(10, 1)].sort()).toEqual(["achievement_badges", "avatar_and_space", "celebration_subtle"]);
    expect(visibleElements(30, 1).has("xp_number_and_level_bar")).toBe(true);
    expect(visibleElements(39, 1).has("celebration_full")).toBe(false);
    expect(visibleElements(40, 1).has("celebration_full")).toBe(true);
    expect(visibleElements(60, 2).has("collectibles_and_unlocks")).toBe(true);
    expect(visibleElements(90, 3).has("collectibles_and_unlocks")).toBe(false);
    expect(visibleElements(100, 1).size).toBe(GAME_ELEMENTS.length);
    expect(visibleElements(9, 1).size).toBe(0);
  });
});

describe("أ.7 الكثافة", () => {
  it("المعادلة: base − 5×avg، × عامل العمر، clamp", () => {
    expect(computeIntensity(1, 0, "child", null)).toBe(90);
    expect(computeIntensity(1, 0, "teen", null)).toBe(77);   // round(90×0.85)
    expect(computeIntensity(1, 0, "adult", null)).toBe(54);  // round(90×0.6)
    expect(computeIntensity(4, 3, "adult", null)).toBe(0);   // (10−15)×0.6 → clamp 0
    expect(computeIntensity(2, 1.5, "teen", null)).toBe(49); // round(57.5×0.85)=49
  });
  it("التجاوز اليدوي للبالغ فقط", () => {
    expect(computeIntensity(1, 0, "adult", 0)).toBe(0);
    expect(computeIntensity(1, 0, "child", 0)).toBe(90);
    expect(computeIntensity(4, 3, "adult", 85)).toBe(85);
  });
  it("avg_support على القدرات النشطة فقط", () => {
    expect(avgSupport([{ confidence: 0.5, support_level: "L2_ask", training_level: "simulated", mastered: false }, { confidence: 0.1, support_level: "L0_instruct", training_level: "simulated", mastered: false }])).toBe(2);
    expect(avgSupport([])).toBe(0);
  });
});

describe("أ.7 المراحل — لا تراجع، انتقال واحد في كل تقييم", () => {
  const cap = (confidence: number, support: "L0_instruct" | "L1_hint" | "L2_ask" | "L3_free", level: "simulated" | "guided_real" | "independent_real" | "transfer" = "simulated") => ({ confidence, support_level: support, training_level: level, mastered: false });
  const base = { daysSinceOnboarding: 10, reflectedMissions: 8, selfCreatedReflectedMissions: 1, transferReports: 1, transferReportsLast30Days: 4, capabilities: [cap(0.5, "L2_ask", "independent_real"), cap(0.5, "L2_ask", "independent_real"), cap(0.5, "L2_ask", "independent_real")] };
  it("1→2 يحتاج 7 أيام و8 مهام وقدرتين بثقة", () => {
    expect(nextStage({ ...base, stage: 1 })).toBe(2);
    expect(nextStage({ ...base, stage: 1, daysSinceOnboarding: 6 })).toBe(1);
    expect(nextStage({ ...base, stage: 1, reflectedMissions: 7 })).toBe(1);
    expect(nextStage({ ...base, stage: 1, capabilities: [cap(0.5, "L2_ask")] })).toBe(1);
  });
  it("2→3 يحتاج avg_support ≥ 1 ومهمة ذاتية وتقرير نقل", () => {
    expect(nextStage({ ...base, stage: 2 })).toBe(3);
    expect(nextStage({ ...base, stage: 2, selfCreatedReflectedMissions: 0 })).toBe(2);
    expect(nextStage({ ...base, stage: 2, transferReports: 0 })).toBe(2);
    expect(nextStage({ ...base, stage: 2, capabilities: [cap(0.5, "L0_instruct")] })).toBe(2);
  });
  it("3→4 يحتاج avg ≥ 2 و3 قدرات ≥ independent_real و4 تقارير نقل في 30 يومًا، ثم يبقى 4", () => {
    expect(nextStage({ ...base, stage: 3 })).toBe(4);
    expect(nextStage({ ...base, stage: 3, transferReportsLast30Days: 3 })).toBe(3);
    expect(nextStage({ ...base, stage: 3, capabilities: [cap(0.5, "L2_ask", "independent_real"), cap(0.5, "L2_ask", "guided_real"), cap(0.5, "L2_ask", "guided_real")] })).toBe(3);
    expect(nextStage({ ...base, stage: 4, transferReportsLast30Days: 0 })).toBe(4);
  });
});

describe("أ.8 المساحة الشخصية", () => {
  it("النقاط من مستويات التدريب (0/1/2/3) والمرحلة من العتبات [0,3,7,12,17,22]، ولا تتراجع", () => {
    const caps = (lvls: Array<"simulated" | "guided_real" | "independent_real" | "transfer">) => lvls.map((l) => ({ training_level: l, mastered: false }));
    expect(avatarPoints(caps(["simulated", "simulated"]))).toBe(0);
    expect(avatarPoints(caps(["guided_real", "independent_real", "transfer"]))).toBe(6);
    expect(avatarPoints([{ training_level: "transfer", mastered: true }])).toBe(3);
    expect(avatarStage(0)).toBe(1); expect(avatarStage(3)).toBe(2); expect(avatarStage(6)).toBe(2); expect(avatarStage(7)).toBe(3); expect(avatarStage(24)).toBe(6);
    expect(displayedAvatarStage(2, 4)).toBe(4);
    expect(displayedAvatarStage(0, 0)).toBe(1);
  });
  it("المستوى التجميلي: 50·n·(n+1)", () => {
    expect(levelForXp(0)).toBe(0); expect(levelForXp(99)).toBe(0); expect(levelForXp(100)).toBe(1); expect(levelForXp(299)).toBe(1); expect(levelForXp(300)).toBe(2);
  });
});

describe("أ.9 الإنجازات", () => {
  it("عدتَ بعد انقطاع: فجوة ≥ 3 أيام وتأمل خلال 48 ساعة من العودة؛ مستويات 1/3/10", () => {
    const t = (d: string) => new Date(d);
    expect(isComeback({ previousActivityAt: t("2026-11-01T10:00Z"), resumedAt: t("2026-11-04T10:00Z"), reflectedAt: t("2026-11-05T09:00Z") })).toBe(true);
    expect(isComeback({ previousActivityAt: t("2026-11-02T10:00Z"), resumedAt: t("2026-11-04T10:00Z"), reflectedAt: t("2026-11-04T11:00Z") })).toBe(false);
    expect(isComeback({ previousActivityAt: t("2026-11-01T10:00Z"), resumedAt: t("2026-11-04T10:00Z"), reflectedAt: t("2026-11-07T09:00Z") })).toBe(false);
    expect(isComeback({ previousActivityAt: null, resumedAt: t("2026-11-04T10:00Z"), reflectedAt: t("2026-11-04T11:00Z") })).toBe(false);
    expect(comebackTierReached(1)).toBe(1); expect(comebackTierReached(2)).toBeNull(); expect(comebackTierReached(3)).toBe(2); expect(comebackTierReached(10)).toBe(3);
  });
  it("تخليتَ بوعي وطبقتَ في سياق جديد", () => {
    expect(isMindfulAbandon({ gate1: false, reflected: true, evidence: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.5 }] })).toBe(true);
    expect(isMindfulAbandon({ gate1: true, reflected: true, evidence: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.9 }] })).toBe(false);
    expect(isMindfulAbandon({ gate1: false, reflected: true, evidence: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.4 }] })).toBe(false);
    expect(newContextCapabilities([{ capability_id: "planning", type: "novel_context", value: 0.6 }, { capability_id: "attention", type: "novel_context", value: 0.4 }, { capability_id: "planning", type: "novel_context", value: 0.9 }])).toEqual(["planning"]);
  });
});

describe("أ.11 اختبار 9 — من توقف عن الاستخدام كليًا لا يحصل على «تلعب أقل»", () => {
  const good = { stage: 3, activeDaysLast28: 6, activeDaysPrev28: 14, workedTransferReportsLast28: 3, capabilityDeltas: [{ start: 60, end: 58, active: true }], masteryChecksInWindow: [{ passed: true }] };
  it("يُمنح عندما تتحقق الشروط الخمسة معًا", () => {
    expect(qualifiesPlayLess(good)).toEqual({ ok: true, failed: [] });
  });
  it("صفر تقارير نقل (ترك التطبيق) → لا يُمنح رغم انخفاض النشاط", () => {
    const left = { ...good, activeDaysLast28: 0, workedTransferReportsLast28: 0 };
    const r = qualifiesPlayLess(left);
    expect(r.ok).toBe(false);
    expect(r.failed).toContain("transfer_reports");
  });
  it("بقية الشروط: المرحلة، نسبة الانخفاض، تراجع قدرة > 10، فحص إتقان فاشل", () => {
    expect(qualifiesPlayLess({ ...good, stage: 2 }).failed).toContain("stage");
    expect(qualifiesPlayLess({ ...good, activeDaysLast28: 12 }).failed).toContain("active_days_drop");
    expect(qualifiesPlayLess({ ...good, capabilityDeltas: [{ start: 70, end: 55, active: true }] }).failed).toContain("capability_drop");
    expect(qualifiesPlayLess({ ...good, capabilityDeltas: [{ start: 70, end: 55, active: false }] }).ok).toBe(true);
    expect(qualifiesPlayLess({ ...good, masteryChecksInWindow: [{ passed: false }] }).failed).toContain("mastery_checks");
  });
});
