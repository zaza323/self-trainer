/**
 * 0.5 ج.5-6: التدهور التلقائي — خطأ مزوّد متكرر يفعّل AI-OFF دون تدخل، ويعود عند الشفاء بعد المدة المحددة (ai.json › ai_off.auto_degrade).
 * وكذلك المهلة واستنفاد الميزانية. الوقت محقون.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { fakeCaller, runFunction } from "@/modules/companion/runtime";
import { ai } from "@/shared/config";
import { aiHealth } from "./health";

const c = ai.ai_off.auto_degrade;
const T0 = new Date("2026-11-09T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60000);
const failing = () => { const f = fakeCaller([]); f.call = async () => { throw new Error("upstream 529 overloaded"); }; return f; };
const call = (db: ReturnType<FakeDb["client"]>, caller: ReturnType<typeof fakeCaller>, now: Date) =>
  runFunction({ db, caller, fn: "strategy_normalizer", profileId: "p", system: "s", messages: [{ role: "user", content: "x" }], schema: z.object({ label: z.string() }), now });

describe("التدهور التلقائي إلى AI-OFF", () => {
  it("أخطاء المزوّد المتكررة ⇒ متوقف تلقائيًا بلا استدعاء للنموذج، ثم يعود بعد مدة التعافي", async () => {
    const db = new FakeDb().client();
    for (let i = 0; i < c.provider_errors_threshold; i++) {
      const r = await call(db, failing(), at(i));
      expect(r).toMatchObject({ ok: false, reason: "error" });
    }
    const last = at(c.provider_errors_threshold - 1);
    expect(await aiHealth(db, last)).toMatchObject({ degraded: true, reason: "provider_error_rate" });
    // متوقف: لا يُستدعى النموذج إطلاقًا
    const healthy = fakeCaller([JSON.stringify({ label: "ok" })]);
    expect(await call(db, healthy, new Date(last.getTime() + 60000))).toMatchObject({ ok: false, reason: "disabled", detail: "provider_error_rate" });
    expect(healthy.calls).toHaveLength(0);
    // بعد مدة التعافي بلا أخطاء جديدة: يعود وحده
    const recovered = new Date(last.getTime() + (c.recover_after_minutes + 1) * 60000);
    expect(await aiHealth(db, recovered)).toEqual({ degraded: false });
    expect(await call(db, healthy, recovered)).toMatchObject({ ok: true, data: { label: "ok" } });
  });
  it("خطأ واحد أقل من العتبة لا يوقف شيئًا", async () => {
    const db = new FakeDb().client();
    await call(db, failing(), T0);
    expect(await aiHealth(db, at(1))).toEqual({ degraded: false });
  });
  it("أخطاء المهلة وحدها ⇒ سبب timeout", async () => {
    const db = new FakeDb().client();
    const slow = fakeCaller([]); slow.call = async () => { throw new Error("Request timed out"); };
    for (let i = 0; i < c.provider_errors_threshold; i++) await call(db, slow, at(i));
    expect(await aiHealth(db, at(c.provider_errors_threshold))).toMatchObject({ degraded: true, reason: "timeout" });
  });
  it("استنفاد الميزانية اليومية العامة ⇒ متوقف حتى الغد", async () => {
    const fake = new FakeDb();
    const db = fake.client();
    for (let i = 0; i < c.daily_global_calls_budget; i++) await db.from("ai_calls").insert({ profile_id: "p", function: "x", valid: true, created_at: at(0).toISOString() });
    const h = await aiHealth(db, at(1));
    expect(h).toMatchObject({ degraded: true, reason: "budget_exhausted", until: "2026-11-10T00:00:00.000Z" });
    expect(await aiHealth(db, new Date("2026-11-10T00:01:00Z"))).toEqual({ degraded: false });
  });
});
