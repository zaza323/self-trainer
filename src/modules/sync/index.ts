// الوحدة: المزامنة دون اتصال (المرحلة 6). الخادم فقط هنا؛ طرف العميل في src/shared/offline.
export { applyClientOps, clampClientAt, syncBatchSchema, clientOpSchema } from "./service";
export type { ClientOp, OpResult, SyncDeps } from "./service";
