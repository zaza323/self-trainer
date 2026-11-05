import Dexie, { type Table } from "dexie";

/**
 * قاعدة الجهاز (IndexedDB عبر Dexie) — المرحلة 6:
 * - ops: طابور العمليات المؤجلة (مفتاح uuid يولّده الجهاز = مفتاح التكرار في الخادم).
 * (صفحة المهمة نفسها تُخزَّن بالـService Worker؛ الحالة المعروضة = حالة الخادم + العمليات المعلقة.)
 */
export type OpKind = "complete" | "interrupt" | "resume" | "reflect" | "abandon";
export type QueuedOp = {
  id: string;
  kind: OpKind;
  mission_id: string;
  payload: Record<string, unknown>;
  client_at: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error?: string;
  next_try_at: number;
};

export class OfflineDb extends Dexie {
  ops!: Table<QueuedOp, string>;
  constructor(name = "self-trainer-offline") {
    super(name);
    this.version(1).stores({ ops: "id, mission_id, status, next_try_at" });
  }
}

let instance: OfflineDb | null = null;
export function offlineDb(): OfflineDb {
  if (!instance) instance = new OfflineDb();
  return instance;
}
