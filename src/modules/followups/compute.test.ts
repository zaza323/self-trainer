/** د.11: ما انتهى وقته، أوراق أو قائمة، «بعدين» مرتين، بطاقة التالي بحالاتها، L2 تسأل وL0 تقترح، الهدوء، الانتقال. */
import { describe, it, expect } from "vitest";
import { buildScheduled, endedItems, presentation, snoozeAllowed, nextCard, transitionStarted, upcomingSoon, type ScheduledItem } from "./compute";
import { instantForLocal } from "@/modules/notifications/plan";

const TZ = "Asia/Amman";
const at = (hhmm: string) => instantForLocal("2026-11-07", hhmm, TZ);
const item = (o: Partial<ScheduledItem> & { s: string; e: string }): ScheduledItem => ({ kind: "task", id: o.id ?? "x", title: o.title ?? "t", startsAt: at(o.s), endsAt: at(o.e), occurrenceDate: "2026-11-07", ...o });

describe("د.11", () => {
  it("1: عادة «رياضة 7:00 لمدة 60» وفتح التطبيق 8:20 ⇒ انتهى وقتها (مهلة 15)", () => {
    const sched = buildScheduled({ date: "2026-11-07", tz: TZ, defaultDurationMin: 30, tasks: [], blocks: [], habits: [{ id: "h", title: "رياضة", schedule: { time_local: "07:00", duration_min: 60 }, scheduledToday: true }] });
    expect(sched).toHaveLength(1);
    expect(endedItems(sched, at("08:20"), { graceMin: 15, lookbackHours: 12 })).toHaveLength(1);
    expect(endedItems(sched, at("08:10"), { graceMin: 15, lookbackHours: 12 })).toHaveLength(0);
    expect(endedItems(sched, instantForLocal("2026-11-08", "09:00", TZ), { graceMin: 15, lookbackHours: 12 })).toHaveLength(0); // أقدم من النافذة ⇒ المتأخر
  });
  it("مهمة بوقت بلا تقدير تأخذ المدة الافتراضية", () => {
    const sched = buildScheduled({ date: "2026-11-07", tz: TZ, defaultDurationMin: 30, tasks: [{ id: "t", title: "اتصال", due_date: "2026-11-07", due_time: "17:00:00", estimate_min: null, status: "open" }], blocks: [], habits: [] });
    expect(sched[0]!.endsAt.toISOString()).toBe(at("17:30").toISOString());
  });
  it("3: 4 عناصر ⇒ قائمة واحدة؛ 12: «بعدين» مرتين فقط", () => {
    expect(presentation(3)).toBe("sheets"); expect(presentation(4)).toBe("list"); expect(presentation(0)).toBe("none");
    expect(snoozeAllowed(0)).toBe(true); expect(snoozeAllowed(1)).toBe(true); expect(snoozeAllowed(2)).toBe(false);
  });
  it("2/5/6/7/9: بطاقة التالي", () => {
    const base = { now: at("08:30"), remainingPriorities: [{ id: "p1", text: "مراجعة" }], prioritiesTotal: 1, freeGapMin: 60, upcomingSoonMin: 30, quietNow: false, windDownNow: false, restSuppressedUntil: null, supportBand: "L0_L1" as const };
    expect(nextCard({ ...base, items: [item({ id: "a", s: "09:00", e: "10:00", title: "دراسة" })] }).card).toMatchObject({ kind: "next", minutesUntil: 30 });
    expect(nextCard({ ...base, items: [item({ id: "a", s: "08:00", e: "10:00" })] }).card).toMatchObject({ kind: "now" });
    expect(nextCard({ ...base, items: [item({ id: "a", s: "10:30", e: "11:00" })] }).card).toMatchObject({ kind: "free_gap", topPriority: { id: "p1" } });
    expect(nextCard({ ...base, items: [] }).card).toMatchObject({ kind: "priority" });
    expect(nextCard({ ...base, items: [], remainingPriorities: [] }).card).toEqual({ kind: "all_done" });
    expect(nextCard({ ...base, items: [], quietNow: true }).card).toEqual({ kind: "quiet" });
    expect(nextCard({ ...base, items: [], windDownNow: true }).card).toEqual({ kind: "wind_down" });
    expect(nextCard({ ...base, items: [item({ id: "a", s: "09:00", e: "10:00" })], restSuppressedUntil: at("09:30") }).card).toEqual({ kind: "rest" });
    const l2 = nextCard({ ...base, supportBand: "L2_L3", items: [item({ id: "a", s: "09:00", e: "10:00", title: "دراسة" })] });
    expect(l2.mode).toBe("ask"); expect(l2.askOptions.map((o) => o.kind)).toEqual(["task", "priority", "rest"]);
    expect(nextCard({ ...base, items: [item({ id: "a", s: "09:00", e: "10:00" })] }).mode).toBe("suggest");
  });
  it("8: الانتقال خلال 10 دقائق؛ «بعد 30 دقيقة: رياضة»", () => {
    expect(transitionStarted(at("10:00"), at("10:08"), 10)).toBe(true);
    expect(transitionStarted(at("10:00"), at("10:12"), 10)).toBe(false);
    expect(upcomingSoon([item({ s: "09:00", e: "10:00", title: "رياضة" })], at("08:35"), 30)?.title).toBe("رياضة");
    expect(upcomingSoon([item({ s: "09:00", e: "10:00" })], at("08:20"), 30)).toBeNull();
  });
});
