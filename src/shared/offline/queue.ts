import { limits } from "@/shared/config";
import type { OfflineDb, QueuedOp, OpKind } from "./db";

/** منطق الطابور خالص قدر الإمكان ليُختبر فوق fake-indexeddb. */
export type SyncResult = { id: string; ok: boolean; error?: string; replayed: boolean };
export type Transport = (ops: Array<Pick<QueuedOp, "id" | "kind" | "mission_id" | "payload" | "client_at">>) => Promise<SyncResult[]>;

export function newOpId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // بديل نادر لمتصفحات قديمة
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); });
}

export async function enqueue(db: OfflineDb, op: { kind: OpKind; mission_id: string; payload?: Record<string, unknown>; client_at?: string; id?: string }): Promise<QueuedOp> {
  const row: QueuedOp = { id: op.id ?? newOpId(), kind: op.kind, mission_id: op.mission_id, payload: op.payload ?? {}, client_at: op.client_at ?? new Date().toISOString(), status: "pending", attempts: 0, next_try_at: 0 };
  await db.ops.add(row);
  return row;
}

export async function pendingOps(db: OfflineDb, missionId?: string): Promise<QueuedOp[]> {
  const all = await db.ops.where("status").equals("pending").toArray();
  const rows = missionId ? all.filter((o) => o.mission_id === missionId) : all;
  return rows.sort((a, b) => a.client_at.localeCompare(b.client_at));
}

export function backoffMs(attempt: number): number {
  const b = limits.offline.retry_backoff_ms;
  return b[Math.min(attempt, b.length - 1)]!;
}

/**
 * يرسل دفعة واحدة (حتى sync_batch_max) من العمليات المستحقة. العمليات التي نجحت أو أُعيد تشغيلها تُحذف من الطابور؛
 * الفاشلة بخطأ منطقي (bad_state…) تُعلَّم failed ولا تُعاد؛ فشل الشبكة يؤجل بالتراجع.
 */
export async function flushOnce(db: OfflineDb, transport: Transport, now = Date.now()): Promise<{ sent: number; ok: number; failed: number; deferred: number; networkError: boolean }> {
  const due = (await pendingOps(db)).filter((o) => o.next_try_at <= now).slice(0, limits.offline.sync_batch_max);
  if (due.length === 0) return { sent: 0, ok: 0, failed: 0, deferred: 0, networkError: false };
  let results: SyncResult[];
  try {
    results = await transport(due.map(({ id, kind, mission_id, payload, client_at }) => ({ id, kind, mission_id, payload, client_at })));
  } catch (e) {
    for (const o of due) {
      const attempts = o.attempts + 1;
      if (attempts >= limits.offline.max_attempts) await db.ops.update(o.id, { status: "failed", attempts, last_error: String((e as Error).message ?? e) });
      else await db.ops.update(o.id, { attempts, next_try_at: now + backoffMs(attempts - 1), last_error: String((e as Error).message ?? e) });
    }
    return { sent: due.length, ok: 0, failed: 0, deferred: due.length, networkError: true };
  }
  let ok = 0, failed = 0;
  for (const o of due) {
    const r = results.find((x) => x.id === o.id);
    if (!r) { await db.ops.update(o.id, { attempts: o.attempts + 1, next_try_at: now + backoffMs(o.attempts) }); continue; }
    if (r.ok || (r.replayed && r.error !== "pending")) { await db.ops.delete(o.id); ok++; }
    else if (r.error === "pending") { await db.ops.update(o.id, { attempts: o.attempts + 1, next_try_at: now + backoffMs(o.attempts) }); }
    else { await db.ops.update(o.id, { status: "failed", last_error: r.error }); failed++; }
  }
  return { sent: due.length, ok, failed, deferred: due.length - ok - failed, networkError: false };
}

/** إسقاط حالة المهمة محليًا من العمليات المعلقة (للعرض دون اتصال). */
export function projectStatus(serverStatus: string, ops: QueuedOp[]): { status: string; reflectedPending: boolean } {
  let status = serverStatus;
  let reflectedPending = false;
  for (const o of ops) {
    if (o.kind === "complete") status = "completed";
    else if (o.kind === "abandon") status = "abandoned";
    else if (o.kind === "interrupt") status = "interrupted";
    else if (o.kind === "resume") status = "in_progress";
    else if (o.kind === "reflect") { status = "reflected"; reflectedPending = true; }
  }
  return { status, reflectedPending };
}
