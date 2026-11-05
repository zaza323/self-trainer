/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { Serwist, NetworkFirst, ExpirationPlugin, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

/**
 * الـService Worker (المرحلة 6، Serwist):
 * - precache لأصول البناء + تخزين الصفحات بـNetworkFirst حتى تعمل آخر صفحة مهمة زارها المستخدم دون اتصال.
 * - سقوط /offline للتنقلات غير المخزنة.
 * - Background Sync: حدث "sync-ops" يطلب من الصفحات تفريغ الطابور (الطابور في IndexedDB بالصفحة).
 * - Web Push + النقر على الإشعار.
 * - إشعار المؤقت المحلي (MIS-4) برسالة من الصفحة.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    { matcher: ({ request }) => request.mode === "navigate", handler: new NetworkFirst({ cacheName: "pages", networkTimeoutSeconds: 10, plugins: [new ExpirationPlugin({ maxEntries: 50 })] }) },
    ...defaultCache,
  ],
  fallbacks: { entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }] },
});
serwist.addEventListeners();

// --- Background Sync: أيقظ الصفحات لتفريغ الطابور؛ وإن لم توجد صفحة، تُفتح الرئيسية عند أول تفاعل (لا نقرأ IndexedDB هنا) ---
self.addEventListener("sync", (event: Event) => {
  const e = event as Event & { tag?: string; waitUntil?: (p: Promise<unknown>) => void };
  if (e.tag !== "sync-ops") return;
  e.waitUntil?.(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => { for (const c of cs) c.postMessage({ type: "flush" }); }));
});

// --- Web Push ---
self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string; type?: string; id?: string } = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() ?? "" }; }
  event.waitUntil(self.registration.showNotification(data.title ?? "", { body: data.body ?? "", data: { url: data.url ?? "/", id: data.id }, tag: data.id ?? data.type, icon: "/icons/icon.svg", badge: "/icons/icon.svg", dir: "rtl", lang: "ar" }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (cs) => {
    for (const c of cs) { if ("focus" in c) { await c.focus(); if ("navigate" in c) await (c as WindowClient).navigate(url); return; } }
    await self.clients.openWindow(url);
  }));
});

// --- إشعار المؤقت المحلي (MIS-4) ---
const timers = new Map<string, ReturnType<typeof setTimeout>>();
self.addEventListener("message", (event) => {
  const m = event.data as { type?: string; tag?: string; at?: number; title?: string; body?: string; url?: string } | undefined;
  if (!m?.type) return;
  if (m.type === "cancel-timer" && m.tag) { const t = timers.get(m.tag); if (t) clearTimeout(t); timers.delete(m.tag); }
  if (m.type === "schedule-timer" && m.tag && m.at) {
    const old = timers.get(m.tag); if (old) clearTimeout(old);
    const delay = Math.max(0, m.at - Date.now());
    timers.set(m.tag, setTimeout(() => { timers.delete(m.tag!); void self.registration.showNotification(m.title ?? "", { body: m.body ?? "", tag: m.tag, data: { url: m.url ?? "/app" }, icon: "/icons/icon.svg", dir: "rtl", lang: "ar" }); }, delay));
  }
});
