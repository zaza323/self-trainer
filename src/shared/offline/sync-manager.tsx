"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { limits } from "@/shared/config";
import { flushAll, refreshPendingCount } from "./client";
import { useOfflineStore } from "./store";
import { updateTimezone } from "@/modules/notifications/actions";
import offlineContent from "@content/offline.ar.json";

/**
 * يُركَّب في غلاف المتدرب: يسجل الـService Worker، يراقب الاتصال، يفرغ الطابور عند العودة/الظهور/دوريًا،
 * ويستجيب لرسالة "flush" من الـService Worker (Background Sync)، ويحدّث المنطقة الزمنية (NOTIF-4).
 */
export function SyncManager({ timezone }: { timezone?: string }) {
  const router = useRouter();
  const { online, pending, phase, set } = useOfflineStore();
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    const onOnline = () => { set({ online: true }); void flushAll().then(() => router.refresh()); };
    const onOffline = () => set({ online: false });
    const onVisible = () => { if (document.visibilityState === "visible" && navigator.onLine) void flushAll().then(() => router.refresh()); };
    const onMessage = (e: MessageEvent) => { if (e.data?.type === "flush") void flushAll().then(() => router.refresh()); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    set({ online: navigator.onLine });
    void refreshPendingCount().then((n) => { if (n > 0 && navigator.onLine) void flushAll().then(() => router.refresh()); });
    const id = setInterval(() => { if (navigator.onLine) void flushAll(); }, limits.offline.flush_interval_ms);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && timezone && tz !== timezone) void updateTimezone(tz);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      clearInterval(id);
    };
  }, [router, set, timezone]);
  if (online && pending === 0 && phase !== "failed") return null;
  const text = !online ? offlineContent.banner_offline : phase === "syncing" ? offlineContent.banner_syncing : phase === "failed" ? offlineContent.banner_failed : offlineContent.banner_pending.replace("{n}", String(pending));
  return <div role="status" className="sticky top-0 z-30 border-b bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">{text}</div>;
}
