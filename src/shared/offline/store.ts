import { create } from "zustand";

/** حالة الاتصال والطابور للواجهة (Zustand). */
export type SyncPhase = "idle" | "syncing" | "synced" | "failed";
export type OfflineState = {
  online: boolean;
  pending: number;
  phase: SyncPhase;
  lastSyncAt: number | null;
  set: (p: Partial<Omit<OfflineState, "set">>) => void;
};
export const useOfflineStore = create<OfflineState>((set) => ({
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  pending: 0,
  phase: "idle",
  lastSyncAt: null,
  set: (p) => set(p),
}));
