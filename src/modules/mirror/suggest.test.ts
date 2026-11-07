/** ط.2 / ط.12-11: اقتراح أسبوع المرآة مرة واحدة، والرفض يمنع التكرار 30 يومًا؛ الشهري؛ المتابعة بعد 2–4 أسابيع. */
import { describe, it, expect } from "vitest";
import { mirrorSuggestionDue, lowFollowThrough, compareDistributions, type SuggestInput } from "./suggest";

const base: SuggestInput = { today: "2026-11-07", gapEnabled: true, monthlyEnabled: false, weeklyFollowThrough: [0.3, 0.2], repeatedShortfall: false, past: [], lastMirrorDate: null, followUpCandidate: null };
describe("اقتراح أسبوع المرآة", () => {
  it("التزام < 0.4 أسبوعين متتاليين فقط", () => {
    expect(lowFollowThrough([0.3, 0.2])).toBe(true); expect(lowFollowThrough([0.5, 0.2])).toBe(false); expect(lowFollowThrough([null, 0.2])).toBe(false);
    expect(mirrorSuggestionDue(base)?.reason).toBe("low_follow_through");
  });
  it("مرة واحدة: معلّق ⇒ لا شيء؛ مرفوض قبل أقل من 30 يومًا ⇒ لا شيء؛ بعد 30 ⇒ يعود", () => {
    expect(mirrorSuggestionDue({ ...base, past: [{ reason: "low_follow_through", status: "pending", created_at: "2026-11-06", decided_at: null }] })).toBeNull();
    expect(mirrorSuggestionDue({ ...base, past: [{ reason: "low_follow_through", status: "rejected", created_at: "2026-10-20", decided_at: "2026-10-20" }] })).toBeNull();
    expect(mirrorSuggestionDue({ ...base, past: [{ reason: "low_follow_through", status: "rejected", created_at: "2026-10-01", decided_at: "2026-10-01" }] })?.reason).toBe("low_follow_through");
  });
  it("الإعداد مطفأ ⇒ لا اقتراح فجوة؛ التقصير المتكرر سبب بديل", () => {
    expect(mirrorSuggestionDue({ ...base, gapEnabled: false })).toBeNull();
    expect(mirrorSuggestionDue({ ...base, weeklyFollowThrough: [0.9, 0.9], repeatedShortfall: true })?.reason).toBe("repeated_shortfall");
  });
  it("المتابعة بين أسبوعين وأربعة من تغيير مختار، مرة واحدة", () => {
    const f = { ...base, gapEnabled: false, followUpCandidate: { id: "r1", date: "2026-10-20" } };
    expect(mirrorSuggestionDue(f)).toEqual({ reason: "follow_up", followUpOf: "r1" });
    expect(mirrorSuggestionDue({ ...f, followUpCandidate: { id: "r1", date: "2026-11-01" } })).toBeNull();
    expect(mirrorSuggestionDue({ ...f, past: [{ reason: "follow_up", status: "accepted", created_at: "2026-11-05", decided_at: "2026-11-05", follow_up_of: "r1" }] })).toBeNull();
  });
  it("الشهري بعد 30 يومًا من آخر مرآة حين يُفعّل", () => {
    expect(mirrorSuggestionDue({ ...base, gapEnabled: false, monthlyEnabled: true, lastMirrorDate: "2026-10-01" })?.reason).toBe("monthly");
    expect(mirrorSuggestionDue({ ...base, gapEnabled: false, monthlyEnabled: true, lastMirrorDate: "2026-10-20" })).toBeNull();
  });
  it("مقارنة الواقع بالواقع بالساعات، الأكبر تغيّرًا أولًا", () => {
    expect(compareDistributions({ phone_screens: 120, study: 60 }, { phone_screens: 60, study: 60 }, 3)[0]).toEqual({ category: "phone_screens", before: 2, now: 1 });
  });
});
