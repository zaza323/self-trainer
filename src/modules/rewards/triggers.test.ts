/** REWARD-2 / 4.12.2: المحفزات الممنوعة تُرفض مع السبب؛ المسموحة تُقيَّم من الوقائع منذ التفعيل. */
import { describe, it, expect } from "vitest";
import { validateTrigger, triggerSatisfied, type TriggerFacts } from "./triggers";
import { customization } from "@/shared/config";

const facts = (o: Partial<TriggerFacts> = {}): TriggerFacts => ({ shownByCapability: {}, trainingLevelByCapability: {}, transferReports: [], achievementCodes: [], completedGoalIds: [], ...o });

describe("validateTrigger", () => {
  it("كل محفز ممنوع يُرفض برسالة تشرح السبب", () => {
    for (const f of customization.real_rewards.forbidden_triggers) {
      const r = validateTrigger(f, { count: 5 }, { allowSurprise: true });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe("forbidden");
      expect(r.ok === false && r.explanation).toContain("التعلم");
    }
  });
  it("المسموح بمعاملات صحيحة يُقبل؛ المعاملات خارج الحدود تُرفض", () => {
    expect(validateTrigger("gate2_shown_count", { capability_id: "attention", count: 3 }, { allowSurprise: true }).ok).toBe(true);
    expect(validateTrigger("gate2_shown_count", { capability_id: "attention", count: 1 }, { allowSurprise: true }).ok).toBe(false);
    expect(validateTrigger("gate2_shown_count", { capability_id: "charisma", count: 3 }, { allowSurprise: true }).ok).toBe(false);
    expect(validateTrigger("training_level_reached", { capability_id: "planning", level: "guided_real" }, { allowSurprise: true }).ok).toBe(true);
    expect(validateTrigger("training_level_reached", { capability_id: "planning", level: "simulated" }, { allowSurprise: true }).ok).toBe(false);
    expect(validateTrigger("transfer_reports", { count: 2 }, { allowSurprise: true })).toMatchObject({ ok: true, params: { count: 2, min_distinct_contexts: 1 } });
    expect(validateTrigger("achievement_earned", { achievement_code: "comeback" }, { allowSurprise: true, achievementCodes: ["comeback"] }).ok).toBe(true);
    expect(validateTrigger("achievement_earned", { achievement_code: "x" }, { allowSurprise: true, achievementCodes: ["comeback"] }).ok).toBe(false);
    expect(validateTrigger("goal_completed", {}, { allowSurprise: true }).ok).toBe(false);
    expect(validateTrigger("unknown", {}, { allowSurprise: true })).toMatchObject({ ok: false, reason: "unknown" });
  });
  it("المفاجأة للمكافآت فقط لا للإنجازات الخاصة", () => {
    expect(validateTrigger("surprise", {}, { allowSurprise: true }).ok).toBe(true);
    expect(validateTrigger("surprise", {}, { allowSurprise: false })).toMatchObject({ ok: false, reason: "surprise_not_allowed" });
  });
});

describe("triggerSatisfied", () => {
  it("ظهور المهارة N مرات في قدرة محددة", () => {
    expect(triggerSatisfied("gate2_shown_count", { capability_id: "attention", count: 2 }, facts({ shownByCapability: { attention: 2 } }))).toBe(true);
    expect(triggerSatisfied("gate2_shown_count", { capability_id: "attention", count: 2 }, facts({ shownByCapability: { attention: 1, planning: 5 } }))).toBe(false);
  });
  it("مستوى تدريب (أو أعلى)، وتقارير نقل ناجحة بسياقات مختلفة", () => {
    expect(triggerSatisfied("training_level_reached", { capability_id: "planning", level: "guided_real" }, facts({ trainingLevelByCapability: { planning: "independent_real" } }))).toBe(true);
    expect(triggerSatisfied("training_level_reached", { capability_id: "planning", level: "transfer" }, facts({ trainingLevelByCapability: { planning: "guided_real" } }))).toBe(false);
    const tr = [{ worked: true, context_tag: "home" }, { worked: true, context_tag: "home" }, { worked: false, context_tag: "study" }];
    expect(triggerSatisfied("transfer_reports", { count: 2, min_distinct_contexts: 1 }, facts({ transferReports: tr }))).toBe(true);
    expect(triggerSatisfied("transfer_reports", { count: 2, min_distinct_contexts: 2 }, facts({ transferReports: tr }))).toBe(false);
  });
  it("إنجاز وغاية ومفاجأة", () => {
    expect(triggerSatisfied("achievement_earned", { achievement_code: "comeback" }, facts({ achievementCodes: ["comeback"] }))).toBe(true);
    expect(triggerSatisfied("goal_completed", { goal_id: "g1" }, facts({ completedGoalIds: ["g1"] }))).toBe(true);
    expect(triggerSatisfied("surprise", {}, facts())).toBe(true);
  });
});
