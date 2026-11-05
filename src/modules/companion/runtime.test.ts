/** اختبارات ثابتة لوقت التشغيل (7.2/7.3): التحقق، إعادة المحاولة مرة، السقوط، الحدود، التسجيل. */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runFunction, fakeCaller } from "./runtime";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { ai } from "@/shared/config";

const schema = z.object({ next_question: z.string().nullable(), n: z.number() });
const base = (db: FakeDb, caller: ReturnType<typeof fakeCaller>) => ({ db: db.client(), caller, fn: "goal_builder" as const, profileId: "p1", system: "s", messages: [{ role: "user" as const, content: "x" }], schema });

describe("runFunction", () => {
  it("مخرج صالح → ok ويُسجَّل valid=true مع prompt_version وmodel_id", async () => {
    const db = new FakeDb();
    const r = await runFunction(base(db, fakeCaller(['{"next_question":"كيف؟","n":1}'])));
    expect(r.ok).toBe(true);
    const log = db.rows("ai_calls");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ function: "goal_builder", valid: true, model_id: "fake-main", attempt: 1 });
    expect(log[0]!.prompt_version).toBeTruthy();
  });
  it("مخرج غير صالح ثم صالح → إعادة محاولة واحدة ثم ok (attempt 2)", async () => {
    const db = new FakeDb();
    const caller = fakeCaller(["ليس JSON", '```json\n{"next_question":null,"n":2}\n```']);
    const r = await runFunction(base(db, caller));
    expect(r.ok).toBe(true);
    expect(caller.calls).toHaveLength(2);
    expect(caller.calls[1]!.messages.at(-1)!.content).toContain("مرفوض");
    expect(db.rows("ai_calls").map((x) => x.valid)).toEqual([false, true]);
  });
  it("غير صالح مرتين → invalid ولا يصل شيء غير متحقق إلى output", async () => {
    const db = new FakeDb();
    const r = await runFunction(base(db, fakeCaller(['{"n":"x"}', '{"nope":1}'])));
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(db.rows("ai_calls").every((x) => x.valid === false && x.output === null)).toBe(true);
    expect(db.rows("ai_calls")).toHaveLength(ai.validation.retries_on_invalid + 1);
  });
  it("verify (قواعد الخادم) يرفض مخرجًا صالحًا شكليًا", async () => {
    const db = new FakeDb();
    const r = await runFunction({ ...base(db, fakeCaller(['{"next_question":"أ؟ ب؟","n":1}', '{"next_question":"أ؟ ب؟","n":1}'])), verify: (o) => ((o.next_question?.match(/؟/g) ?? []).length > 1 ? "two_questions" : null) });
    expect(r).toMatchObject({ ok: false, reason: "invalid", detail: "two_questions" });
  });
  it("المفتاح معطّل → disabled بلا استدعاء ولا تسجيل", async () => {
    const db = new FakeDb();
    const caller = fakeCaller(['{"next_question":null,"n":1}'], { enabled: false });
    expect(await runFunction(base(db, caller))).toEqual({ ok: false, reason: "disabled" });
    expect(caller.calls).toHaveLength(0);
  });
  it("بلوغ الحد اليومي لكل مستخدم لكل وظيفة → limit", async () => {
    const db = new FakeDb();
    const n = ai.functions.goal_builder.daily_calls_per_profile!;
    db.seed("ai_calls", Array.from({ length: n }, () => ({ profile_id: "p1", function: "goal_builder", created_at: new Date().toISOString() })));
    const caller = fakeCaller(['{"next_question":null,"n":1}']);
    expect(await runFunction(base(db, caller))).toEqual({ ok: false, reason: "limit" });
    expect(caller.calls).toHaveLength(0);
    // مستخدم آخر غير متأثر
    expect((await runFunction({ ...base(db, caller), profileId: "p2" })).ok).toBe(true);
  });
  it("خطأ الشبكة → error ومسجَّل", async () => {
    const db = new FakeDb();
    const r = await runFunction(base(db, fakeCaller([() => { throw new Error("boom"); }])));
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(db.rows("ai_calls")[0]).toMatchObject({ valid: false, error: "boom" });
  });
});
