/** ط.12 (الشق اليدوي): الملء المسبق، الفجوات، التوزيع، الأنماط الحتمية، R1، لا سلبي من الواقع، حارس النص. */
import { describe, it, expect } from "vitest";
import { prefillSegments, gaps, distribution, unknownShare, plannedShare, detectPatterns, predictionAwareness, forbiddenMirrorText, pickPredictionCategories, mergeOverlaps, noNegativeFromBehavior, mirrorTitle, type Segment } from "./reconstruct";
import { instantForLocal } from "@/modules/notifications/plan";

const TZ = "Asia/Amman";
const t = (d: string, h: string) => instantForLocal(d, h, TZ).toISOString();
const seg = (d: string, s: string, e: string, category: string, extra: Partial<Segment> = {}): Segment => ({ starts_at: t(d, s), ends_at: t(d, e), category, origin: "manual", was_planned: false, ...extra });

describe("ط.12", () => {
  it("2: يوم فيه 3 «تمّت» وجلسة تركيز ⇒ مقاطع مملوءة مسبقًا، والتداخل يُقصّ", () => {
    const segs = prefillSegments({
      followupsDone: [{ title: "رياضة", startsAt: t("2026-11-07", "07:00"), endsAt: t("2026-11-07", "08:00"), category: "exercise" }, { title: "مراجعة", startsAt: t("2026-11-07", "16:00"), endsAt: t("2026-11-07", "17:00"), category: "study" }, { title: "اتصال", startsAt: t("2026-11-07", "18:00"), endsAt: t("2026-11-07", "18:30"), category: "work" }],
      focusSessions: [{ started_at: t("2026-11-07", "16:30"), ended_at: t("2026-11-07", "17:30"), minutes: 60, title: "مذاكرة" }],
      blocks: [], restSessions: [], retro: [], sleep: { wake: t("2026-11-07", "06:30"), dayStart: t("2026-11-07", "00:00") },
    });
    expect(segs.map((s) => s.category)).toEqual(["sleep", "exercise", "study", "study", "work"]);
    expect(segs.every((s) => s.origin === "prefilled")).toBe(true);
    expect(segs[3]!.starts_at).toBe(t("2026-11-07", "17:00")); // قُصّ التداخل
    const g = gaps(segs, t("2026-11-07", "00:00"), t("2026-11-07", "20:00"));
    expect(g).toHaveLength(4); // 06:30–07:00، 08:00–16:00، 17:30–18:00، 18:30–20:00
    expect(g[1]).toEqual({ start: t("2026-11-07", "08:00"), end: t("2026-11-07", "16:00") });
    expect(gaps(segs, t("2026-11-07", "00:00"), t("2026-11-07", "20:00"), 60)).toHaveLength(2);
  });
  it("التوزيع ونسبة «ما بتذكر» والمخطط له", () => {
    const segs = [seg("2026-11-07", "09:00", "11:00", "phone_screens"), seg("2026-11-07", "11:00", "12:00", "study", { was_planned: true }), seg("2026-11-07", "12:00", "13:00", "unknown")];
    expect(distribution(segs)).toEqual({ phone_screens: 120, study: 60, unknown: 60 });
    expect(unknownShare(segs)).toBeCloseTo(0.25, 3); expect(plannedShare(segs)).toBeCloseTo(0.25, 3);
    expect(mergeOverlaps([seg("2026-11-07", "09:00", "10:00", "a"), seg("2026-11-07", "09:30", "11:00", "b")])[1]!.starts_at).toBe(t("2026-11-07", "10:00"));
  });
  it("الأنماط حتمية بحد 3: «بعد العشا كل يوم ساعتين جوال»، نسبة ما بتذكر، ساعات الطاقة", () => {
    const days = ["2026-11-05", "2026-11-06", "2026-11-07"].map((d) => [seg(d, "20:00", "22:00", "phone_screens"), seg(d, "09:00", "11:00", "study", { energy: "high", was_planned: true }), seg(d, "12:00", "14:00", "unknown")]);
    const p = detectPatterns(days, TZ);
    expect(p.length).toBeLessThanOrEqual(3);
    expect(p[0]).toMatchObject({ rule: "top_categories" });
    expect(p.find((x) => x.rule === "same_window_3_days")).toMatchObject({ category: "phone_screens", hour: 20 });
    expect(p.find((x) => x.rule === "unknown_share_above_0.25")).toMatchObject({ share: 0.33 });
  });
  it("7/8: توقّع 1.5 ساعة جوال والواقع 3.7 ⇒ R1 بالقيمة الصحيحة؛ لا سلبي من الواقع؛ 3 فئات للتوقّع", () => {
    // rel = |3.7−1.5|/1.5 = 1.4667 ⇒ 1 − 2×1.4667 = −1.93 ⇒ قُصّت إلى −1 (دليل وعي بالتوقّع، لا حكم على السلوك)
    expect(predictionAwareness([{ category: "phone_screens", predicted_hours: 1.5, actual_hours: 3.7 }])).toBe(-1);
    expect(predictionAwareness([{ category: "study", predicted_hours: 2, actual_hours: 2.5 }])).toBeCloseTo(0.5, 3);
    expect(predictionAwareness([])).toBeNull();
    expect(noNegativeFromBehavior).toBe(true);
    expect(pickPredictionCategories({ phone_screens: 200, study: 60, sleep: 400, unknown: 100 }, ["study"])).toEqual(["study", "sleep", "phone_screens"]);
  });
  it("5/6: حارس النص — لا «ضيّعت» ولا مقارنة بالآخرين؛ العنوان ثابت", () => {
    expect(forbiddenMirrorText("ضيّعت ساعتين")).toBe("ضيّعت"); expect(forbiddenMirrorText("أنت أحسن من غيرك")).toBe("comparison_with_others"); expect(forbiddenMirrorText("بعد العشا الجوال بياخد ساعتين. هاد شي بدك تغيره؟")).toBeNull();
    expect(mirrorTitle).toBe("مش حكم، صورة");
  });
});
