import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { OfflineDb } from "./db";
import { enqueue, flushOnce, pendingOps, projectStatus, backoffMs, type Transport } from "./queue";
import { limits } from "@/shared/config";

let db: OfflineDb;
beforeEach(() => { db = new OfflineDb(`t-${Math.random().toString(36).slice(2)}`); });

describe("طابور المزامنة دون اتصال (المرحلة 6)", () => {
  it("إدراج → معلق بمفتاح uuid؛ الإرسال الناجح يحذفه", async () => {
    const op = await enqueue(db, { kind: "complete", mission_id: "m1" });
    expect(op.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await pendingOps(db)).length).toBe(1);
    const sent: unknown[] = [];
    const transport: Transport = async (ops) => { sent.push(...ops); return ops.map((o) => ({ id: o.id, ok: true, replayed: false })); };
    const r = await flushOnce(db, transport);
    expect(r).toMatchObject({ sent: 1, ok: 1, failed: 0 });
    expect((await pendingOps(db)).length).toBe(0);
    expect((sent[0] as { id: string }).id).toBe(op.id);
  });
  it("إعادة التشغيل (replayed) تُعامل كنجاح؛ الخطأ المنطقي يُعلَّم failed ولا يُعاد", async () => {
    const a = await enqueue(db, { kind: "complete", mission_id: "m1" });
    const b = await enqueue(db, { kind: "reflect", mission_id: "m1", payload: { prompts: ["س"], answers: ["ج"] } });
    const r = await flushOnce(db, async (ops) => ops.map((o) => (o.id === a.id ? { id: o.id, ok: true, replayed: true } : { id: o.id, ok: false, error: "bad_state", replayed: false })));
    expect(r).toMatchObject({ ok: 1, failed: 1 });
    expect((await pendingOps(db)).length).toBe(0);
    expect((await db.ops.get(b.id))?.status).toBe("failed");
  });
  it("فشل الشبكة يؤجل بالتراجع من config ثم يعلّم failed بعد max_attempts", async () => {
    const op = await enqueue(db, { kind: "interrupt", mission_id: "m2" });
    const boom: Transport = async () => { throw new Error("offline"); };
    const now = 1_000_000;
    const r = await flushOnce(db, boom, now);
    expect(r.networkError).toBe(true);
    const row = (await db.ops.get(op.id))!;
    expect(row.attempts).toBe(1);
    expect(row.next_try_at).toBe(now + backoffMs(0));
    expect((await flushOnce(db, boom, now)).sent).toBe(0); // ليس مستحقًا بعد
    for (let i = 1; i < limits.offline.max_attempts; i++) await flushOnce(db, boom, now + limits.offline.retry_backoff_ms.at(-1)! * (i + 1) * 10);
    expect((await db.ops.get(op.id))?.status).toBe("failed");
  });
  it("الدفعة لا تتجاوز sync_batch_max ومرتبة بوقت العميل", async () => {
    for (let i = 0; i < limits.offline.sync_batch_max + 2; i++) await enqueue(db, { kind: "abandon", mission_id: `m${i}`, client_at: new Date(2026, 0, 1, 0, i).toISOString() });
    let got: string[] = [];
    const r = await flushOnce(db, async (ops) => { got = ops.map((o) => o.mission_id); return ops.map((o) => ({ id: o.id, ok: true, replayed: false })); });
    expect(r.sent).toBe(limits.offline.sync_batch_max);
    expect(got[0]).toBe("m0");
  });
  it("إسقاط الحالة محليًا من العمليات المعلقة", () => {
    const mk = (kind: "complete" | "reflect" | "interrupt" | "resume" | "abandon") => ({ id: kind, kind, mission_id: "m", payload: {}, client_at: "", status: "pending" as const, attempts: 0, next_try_at: 0 });
    expect(projectStatus("in_progress", [mk("interrupt"), mk("resume")])).toEqual({ status: "in_progress", reflectedPending: false });
    expect(projectStatus("in_progress", [mk("complete"), mk("reflect")])).toEqual({ status: "reflected", reflectedPending: true });
    expect(projectStatus("in_progress", [mk("abandon")]).status).toBe("abandoned");
  });
});
