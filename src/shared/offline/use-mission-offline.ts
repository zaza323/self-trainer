"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { liveQuery } from "dexie";
import { offlineDb, type OpKind, type QueuedOp } from "./db";
import { pendingOps, projectStatus } from "./queue";
import { flushAll, queueOp } from "./client";
import { useOfflineStore } from "./store";

/**
 * يجعل شاشة المهمة تعمل دون اتصال: الحالة المعروضة = حالة الخادم + العمليات المعلقة؛
 * والإرسال يذهب للطابور إن لم يكن هناك اتصال (أو إن فشل الطلب بسبب الشبكة).
 */
export function useMissionOffline(missionId: string, serverStatus: string) {
  const router = useRouter();
  const online = useOfflineStore((s) => s.online);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => pendingOps(offlineDb(), missionId)).subscribe({ next: setOps, error: () => setOps([]) });
    return () => sub.unsubscribe();
  }, [missionId]);
  const projected = projectStatus(serverStatus, ops);
  const submitOffline = useCallback(async (kind: OpKind, payload: Record<string, unknown> = {}) => {
    await queueOp({ kind, mission_id: missionId, payload });
    if (navigator.onLine) void flushAll().then(() => router.refresh());
  }, [missionId, router]);
  return { online, ops, status: projected.status, reflectedPending: projected.reflectedPending, submitOffline };
}
