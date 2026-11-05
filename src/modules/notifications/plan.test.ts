import { describe, it, expect } from "vitest";
import { localParts, instantForLocal, inQuietHours, quietEnd, nextDailySlot, decideDelivery, addDays } from "./plan";
import { limits } from "@/shared/config";

const TZ = "Asia/Amman"; // UTC+3 دائمًا منذ 2022

describe("الوقت المحلي والمنطقة الزمنية (NOTIF-4)", () => {
  it("instantForLocal ↔ localParts متسقان", () => {
    const at = instantForLocal("2026-11-05", "17:00", TZ);
    expect(at.toISOString()).toBe("2026-11-05T14:00:00.000Z");
    const lp = localParts(at, TZ);
    expect(lp).toMatchObject({ date: "2026-11-05", hhmm: "17:00", minutes: 17 * 60 });
  });
  it("منطقة زمنية غير معروفة تسقط إلى UTC بلا انهيار", () => {
    expect(localParts(new Date("2026-11-05T10:00:00Z"), "Nowhere/City").hhmm).toBe("10:00");
  });
  it("addDays يعبر الشهور", () => { expect(addDays("2026-11-30", 1)).toBe("2026-12-01"); });
  it("nextDailySlot: اليوم إن لم يمض الوقت وإلا غدًا", () => {
    const before = instantForLocal("2026-11-05", "16:59", TZ);
    const after = instantForLocal("2026-11-05", "17:01", TZ);
    expect(nextDailySlot(before, TZ, "17:00").toISOString()).toBe("2026-11-05T14:00:00.000Z");
    expect(nextDailySlot(after, TZ, "17:00").toISOString()).toBe("2026-11-06T14:00:00.000Z");
  });
});

describe("ساعات الهدوء (NOTIF-1)", () => {
  it("مدى يلتف حول منتصف الليل", () => {
    expect(inQuietHours(23 * 60, ["22:00", "07:00"])).toBe(true);
    expect(inQuietHours(3 * 60, ["22:00", "07:00"])).toBe(true);
    expect(inQuietHours(12 * 60, ["22:00", "07:00"])).toBe(false);
    expect(inQuietHours(7 * 60, ["22:00", "07:00"])).toBe(false);
  });
  it("مدى عادي وفارغ", () => {
    expect(inQuietHours(13 * 60, ["12:00", "14:00"])).toBe(true);
    expect(inQuietHours(13 * 60, ["12:00", "12:00"])).toBe(false);
    expect(inQuietHours(13 * 60, null)).toBe(false);
  });
  it("quietEnd: في الليل → صباح الغد؛ في الفجر → صباح اليوم نفسه", () => {
    expect(quietEnd(instantForLocal("2026-11-05", "23:00", TZ), TZ, ["22:00", "07:00"]).toISOString()).toBe("2026-11-06T04:00:00.000Z");
    expect(quietEnd(instantForLocal("2026-11-06", "03:00", TZ), TZ, ["22:00", "07:00"]).toISOString()).toBe("2026-11-06T04:00:00.000Z");
  });
});

describe("قرار التسليم (NOTIF-1، NOTIF-5)", () => {
  const base = { tz: TZ, bypass: false, sentTodayCount: 0, maxPerDay: 1, hardCap: limits.notifications.hard_cap_per_day, quiet: ["22:00", "07:00"] as [string, string], notificationTime: "17:00" };
  it("يُرسل في النهار تحت الحد", () => {
    expect(decideDelivery({ ...base, now: instantForLocal("2026-11-05", "17:05", TZ) })).toEqual({ action: "send" });
  });
  it("الحد اليومي بلغ → يؤجَّل إلى وقت الإشعار غدًا", () => {
    const d = decideDelivery({ ...base, now: instantForLocal("2026-11-05", "17:05", TZ), sentTodayCount: 1 });
    expect(d).toMatchObject({ action: "defer", reason: "cap" });
    expect((d as { until: Date }).until.toISOString()).toBe("2026-11-06T14:00:00.000Z");
  });
  it("ساعات الهدوء → يؤجَّل إلى نهايتها", () => {
    const d = decideDelivery({ ...base, now: instantForLocal("2026-11-05", "23:30", TZ) });
    expect(d).toMatchObject({ action: "defer", reason: "quiet" });
    expect((d as { until: Date }).until.toISOString()).toBe("2026-11-06T04:00:00.000Z");
  });
  it("الأمان يتجاوز الحد والهدوء (NOTIF-5)", () => {
    expect(decideDelivery({ ...base, now: instantForLocal("2026-11-05", "23:30", TZ), sentTodayCount: 5, bypass: true })).toEqual({ action: "send" });
  });
  it("الحد الصلب 3 لا يُتجاوز حتى لو ضُبط أعلى؛ وصفر يُسقط", () => {
    expect(decideDelivery({ ...base, now: instantForLocal("2026-11-05", "17:05", TZ), maxPerDay: 10, sentTodayCount: limits.notifications.hard_cap_per_day })).toMatchObject({ action: "defer" });
    expect(decideDelivery({ ...base, now: instantForLocal("2026-11-05", "17:05", TZ), maxPerDay: 0 })).toEqual({ action: "drop", reason: "cap_zero" });
  });
});
