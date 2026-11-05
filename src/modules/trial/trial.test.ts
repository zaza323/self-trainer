/** المرحلة 8: مقاييس القسم 15 والتحذيران المضادان والقياس المجهّل — دوال خالصة. */
import { describe, it, expect } from "vitest";
import { computeCohortMetrics, skillGrowth, transferRate, autonomy, masteryOverAchievement, novelContext, healthyReturn, adaptationAcceptance, warnXpWithoutLearning, warnRewardDisplacesMotivation, type ParticipantData } from "./metrics";
import { sanitizeEvent, profileHash, track } from "./analytics";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { trial } from "@/shared/config";

const J = "2026-10-01T00:00:00Z";
const day = (n: number) => new Date(Date.parse(J) + n * 86400000).toISOString();
const m = (n: number, gate2: "shown" | "partial" | "not_yet" | null = "shown", over: Partial<ParticipantData["missions"][number]> = {}) => ({ completed_at: day(n), gate1: true, gate2, has_transfer: false, is_real: true, ...over });
const base = (over: Partial<ParticipantData> = {}): ParticipantData => ({
  profile_id: "a", age_mode: "teen", joined_at: J, missions: [], scoresWeek: {}, supportStart: {}, supportEnd: {}, helpNeededWeek: {}, evidenceNovel: [], evidenceUsual: [], activeDays: [], suggestions: { decided: 0, accepted: 0 }, xpWeek: {}, rewardDeliveries: [], focusCapabilities: [], ...over,
});

describe("مقاييس النجاح (القسم 15)", () => {
  it("نمو المهارة: المؤهلون ≥ 10 مهام، تحسن ≥ 2 قدرات مستهدفة بين الأسبوع 1 و4", () => {
    const c = trial.metrics.skill_growth;
    const good = base({ missions: Array(c.min_missions).fill(m(1)), scoresWeek: { 1: { attention: 40, planning: 40 }, 4: { attention: 50, planning: 45 } }, focusCapabilities: ["attention", "planning"] });
    const flat = base({ profile_id: "b", missions: Array(c.min_missions).fill(m(1)), scoresWeek: { 1: { attention: 40, planning: 40 }, 4: { attention: 40, planning: 41 } }, focusCapabilities: ["attention", "planning"] });
    const few = base({ profile_id: "c", missions: [m(1)], scoresWeek: { 1: { attention: 1 }, 4: { attention: 90 } } });
    const r = skillGrowth([good, flat, few]);
    expect(r).toMatchObject({ n: 2, value: 0.5, met: true });
    expect(skillGrowth([few]).met).toBeNull();
  });
  it("نقل التعلم: نسبة المهام الواقعية التي تلاها تقرير نقل ≥ 30%", () => {
    const p = base({ missions: [m(1, "shown", { has_transfer: true }), m(2), m(3), m(4, "shown", { is_real: false, has_transfer: true })] });
    expect(transferRate([p])).toMatchObject({ value: 0.333, met: true, n: 3 });
  });
  it("الاستقلالية: انتقال ≥ 1 مستوى دعم في قدرة واحدة على الأقل", () => {
    const up = base({ supportStart: { attention: "L1_hint" }, supportEnd: { attention: "L2_ask" }, helpNeededWeek: { 1: 0.2, 4: 0.6 } });
    const same = base({ profile_id: "b", supportStart: { attention: "L1_hint" }, supportEnd: { attention: "L1_hint" } });
    const r = autonomy([up, same]);
    expect(r).toMatchObject({ value: 0.5, met: true, n: 2 });
    expect(r.note).toContain("help_needed_delta_mean=0.4");
  });
  it("الإتقان لا الإنجاز: نسبة shown إلى 'أنجز فقط' ترتفع بين الأسبوعين", () => {
    const p = base({ missions: [m(1, "not_yet"), m(2, "shown"), m(22, "shown"), m(23, "shown"), m(24, "not_yet")] });
    const r = masteryOverAchievement([p]);
    expect(r.met).toBe(true);
    expect(r.note).toBe("w1=1 w4=2");
  });
  it("سياق جديد: الفرق النسبي ≤ 20%", () => {
    expect(novelContext([base({ evidenceNovel: [0.7, 0.8], evidenceUsual: [0.8, 0.8] })])).toMatchObject({ value: 0.063, met: true });
    expect(novelContext([base({ evidenceNovel: [0.2], evidenceUsual: [0.8] })]).met).toBe(false);
    expect(novelContext([base()]).met).toBeNull();
  });
  it("العودة الصحية بعد 7 و30 يومًا بين المؤهلين فقط", () => {
    const now = new Date(day(35));
    const back = base({ activeDays: [day(1).slice(0, 10), day(8).slice(0, 10)] });
    const gone = base({ profile_id: "b", activeDays: [day(1).slice(0, 10)] });
    const [r7, r30] = healthyReturn([back, gone], now);
    expect(r7).toMatchObject({ key: "return_7", value: 0.5, met: true, n: 2 });
    expect(r30).toMatchObject({ key: "return_30", value: 0, met: false });
    expect(healthyReturn([back], new Date(day(3)))[0]!.met).toBeNull();
  });
  it("قبول التكيّف ≥ 40%", () => {
    expect(adaptationAcceptance([base({ suggestions: { decided: 5, accepted: 2 } })])).toMatchObject({ value: 0.4, met: true });
    expect(adaptationAcceptance([base()]).met).toBeNull();
  });
});

describe("التحذيران المضادان", () => {
  it("1: XP يرتفع ≥ 50% والقدرات ثابتة (متوسط الفرق ≤ 2)", () => {
    const hit = base({ xpWeek: { 1: 100, 4: 200 }, scoresWeek: { 1: { attention: 50 }, 4: { attention: 51 } } });
    const learn = base({ profile_id: "b", xpWeek: { 1: 100, 4: 200 }, scoresWeek: { 1: { attention: 50, planning: 50 }, 4: { attention: 70, planning: 60 } } });
    expect(warnXpWithoutLearning([hit, learn])).toMatchObject({ key: "xp_without_learning", profiles: 1 });
    expect(warnXpWithoutLearning([learn])).toBeNull();
  });
  it("2: نسبة shown تنخفض ≥ 15 نقطة في الأسبوعين التاليين لتسليم مكافأة", () => {
    const before = [m(1), m(2), m(3)], after = [m(15, "not_yet"), m(16, "not_yet"), m(17, "shown")];
    const hit = base({ missions: [...before, ...after], rewardDeliveries: [{ at: day(14) }] });
    expect(warnRewardDisplacesMotivation([hit])).toMatchObject({ key: "reward_displaces_motivation", profiles: 1, detail: { deliveries_evaluated: 1 } });
    const fine = base({ missions: [...before, m(15), m(16), m(17)], rewardDeliveries: [{ at: day(14) }] });
    expect(warnRewardDisplacesMotivation([fine])).toBeNull();
    expect(warnRewardDisplacesMotivation([base({ missions: before, rewardDeliveries: [{ at: day(14) }] })])).toBeNull(); // عينة غير كافية
  });
  it("المجموعة: التوزيع على الأوضاع وقائمة المقاييس الثمانية", () => {
    const r = computeCohortMetrics([base(), base({ profile_id: "b", age_mode: "adult" })], new Date(day(3)));
    expect(r.by_mode).toEqual({ teen: 1, adult: 1 });
    expect(r.metrics.map((x) => x.key)).toEqual(["skill_growth", "transfer_rate", "autonomy", "mastery_over_achievement", "novel_context", "return_7", "return_30", "adaptation_acceptance"]);
  });
});

describe("القياس المجهّل (القسم 9)", () => {
  it("حدث خارج القائمة يُرفض؛ الخصائص غير المسموحة والجمل تُحذف؛ المعرّف يُستبدل بـ hash مملّح", () => {
    expect(sanitizeEvent({ event: "chat_message" })).toEqual({ error: "event_not_allowed" });
    const s = sanitizeEvent({ event: "mission_reflected", profileId: "p-1", props: { age_mode: "teen", gate2: "shown", reflection_text: "كتبت تأملًا طويلًا", note: "هذه جملة فيها كلمات كثيرة جدًا", count: 3, worked: true } }, "salt");
    expect("error" in s).toBe(false);
    if (!("error" in s)) {
      expect(s.props).toEqual({ age_mode: "teen", gate2: "shown", count: 3, worked: true });
      expect(s.profile_hash).toBe(profileHash("p-1", "salt"));
      expect(s.profile_hash).toHaveLength(trial.analytics.profile_hash_length);
      expect(s.profile_hash).not.toContain("p-1");
    }
  });
  it("track يحفظ في product_events ويرسل إلى PostHog إن وُجد ولا يرمي", async () => {
    const db = new FakeDb();
    const sent: unknown[] = [];
    expect(await track(db.client(), { event: "transfer_reported", profileId: "p", props: { worked: true } }, async (p) => { sent.push(p); })).toBe(true);
    expect(db.rows("product_events")).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(await track(db.client(), { event: "nope" }, null)).toBe(false);
  });
});
