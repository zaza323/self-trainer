/**
 * التزام النوم (bedtime_adherence): يُحسب فقط من تسجيل المستخدم لعادة النوم التي أنشأها، ولا يُستنتج أبدًا من نشاط التطبيق.
 * قاعدة بيانات «مسجِّلة» تحفظ كل استعلام، فنتأكد أن لا استعلام يقرأ آخر استعمال أو موعد النوم لاستنتاج النوم.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayMetrics, sleepHabitOf } from "./service";
import type { HabitSchedule, Checkin } from "@/modules/planner/habits";

type Call = { table: string; columns: string };
function recorder(rows: Record<string, unknown[]>): { db: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["eq", "in", "gte", "lt", "lte", "gt", "order", "limit", "is", "neq"]) q[m] = () => q;
      q.select = (columns: string) => { calls.push({ table, columns }); return q; };
      q.then = (res: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: rows[table] ?? [] }).then(res);
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const P = { id: "p", age_mode: "teen" as const, timezone: "Asia/Amman" };
const DATE = "2026-11-07";
// نشاط ليلي متأخر في التطبيق: لو استُنتج النوم منه لظهر المؤشر
const lateActivity = { app_opens: [{ local_date: DATE, first_at: "2026-11-07T05:00:00Z", last_at: "2026-11-07T22:59:00Z" }] };
const sleepHabit = (checkins: Checkin[]) => ({ id: "h-sleep", schedule: { kind: "daily", time_local: "22:30", bedtime: true } as unknown as HabitSchedule, checkins });
const otherHabit = { id: "h-read", schedule: { kind: "daily" } as HabitSchedule, checkins: [{ date: DATE, done: true, flex_used: false }] };

describe("bedtime_adherence لا يُستنتج من نشاط التطبيق", () => {
  it("بلا عادة نوم: لا يُحسب أبدًا، حتى مع نشاط ليلي متأخر في التطبيق", async () => {
    const { db } = recorder(lateActivity);
    const m = await dayMetrics(db, P, DATE, [otherHabit], "sat");
    expect(m.values).not.toHaveProperty("bedtime_adherence");
    expect(m.active).toBe(true); // النشاط يحدد «يوم نشط» فقط، لا النوم
  });
  it("مع عادة نوم: من تسجيل المستخدم وحده (1 إن سجّل، 0 إن لم يسجّل)، والنشاط لا يغيّر النتيجة", async () => {
    expect((await dayMetrics(recorder(lateActivity).db, P, DATE, [sleepHabit([{ date: DATE, done: true, flex_used: false }])], "sat")).values.bedtime_adherence).toBe(1);
    expect((await dayMetrics(recorder(lateActivity).db, P, DATE, [sleepHabit([])], "sat")).values.bedtime_adherence).toBe(0);
    expect((await dayMetrics(recorder({}).db, P, DATE, [sleepHabit([{ date: DATE, done: true, flex_used: false }])], "sat")).values.bedtime_adherence).toBe(1);
  });
  it("ولا استعلام يقرأ آخر استعمال للتطبيق أو موعد النوم", async () => {
    const { db, calls } = recorder(lateActivity);
    await dayMetrics(db, P, DATE, [sleepHabit([])], "sat");
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.columns, `${c.table}: ${c.columns}`).not.toMatch(/last_at|first_at|bedtime/);
    expect(calls.filter((c) => c.table === "app_opens").map((c) => c.columns)).toEqual(["local_date"]);
  });
  it("لا مصدر في وحدة الوتيرة يقرأ last_at أو target_bedtime", () => {
    const dir = path.resolve(__dirname);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.includes(".test."))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/last_at|target_bedtime/);
    }
  });
  it("عادة النوم = العادة التي أنشأها المستخدم كعادة نوم فقط", () => {
    expect(sleepHabitOf([otherHabit])).toBeNull();
    expect(sleepHabitOf([otherHabit, sleepHabit([])])?.id).toBe("h-sleep");
  });
});
