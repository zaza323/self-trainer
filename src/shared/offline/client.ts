"use client";
import { limits } from "@/shared/config";
import { offlineDb, type OpKind } from "./db";
import { enqueue, flushOnce, pendingOps, type Transport } from "./queue";
import { useOfflineStore } from "./store";

/** النقل الحقيقي: POST /api/sync. */
export const httpTransport: Transport = async (ops) => {
  const res = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }), credentials: "same-origin" });
  if (!res.ok) throw new Error(`sync_http_${res.status}`);
  const j = (await res.json()) as { results: Awaited<ReturnType<Transport>> };
  return j.results;
};

let flushing: Promise<void> | null = null;
/** يفرغ الطابور كله (دفعة تلو دفعة) ويحدّث المتجر. آمن للاستدعاء المتكرر. */
export function flushAll(transport: Transport = httpTransport): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const db = offlineDb();
    const store = useOfflineStore.getState();
    const before = (await pendingOps(db)).length;
    if (before === 0) { store.set({ pending: 0 }); return; }
    store.set({ phase: "syncing", pending: before });
    let failedAny = false;
    for (let i = 0; i < Math.ceil(before / limits.offline.sync_batch_max) + 1; i++) {
      const r = await flushOnce(db, transport);
      if (r.networkError) { failedAny = true; break; }
      if (r.failed) failedAny = true;
      if (r.sent === 0) break;
    }
    const after = (await pendingOps(db)).length;
    store.set({ pending: after, phase: failedAny ? "failed" : "synced", lastSyncAt: Date.now() });
  })().finally(() => { flushing = null; });
  return flushing;
}

export async function queueOp(op: { kind: OpKind; mission_id: string; payload?: Record<string, unknown> }) {
  const row = await enqueue(offlineDb(), op);
  const n = (await pendingOps(offlineDb())).length;
  useOfflineStore.getState().set({ pending: n });
  // Background Sync إن توفر: يوقظ الـService Worker حين يعود الاتصال حتى لو أُغلقت الصفحة
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sync = (reg as unknown as { sync?: { register: (tag: string) => Promise<void> } }).sync;
    await sync?.register("sync-ops");
  } catch { /* غير مدعوم */ }
  return row;
}

export async function refreshPendingCount() {
  const n = (await pendingOps(offlineDb())).length;
  useOfflineStore.getState().set({ pending: n });
  return n;
}
