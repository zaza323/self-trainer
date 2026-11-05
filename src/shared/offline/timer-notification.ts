"use client";
/** MIS-4: إشعار محلي عند انتهاء المؤقت عبر الـService Worker (يعمل والتطبيق في الخلفية ما دام الـSW حيًا). */
export async function scheduleTimerNotification(opts: { at: number; title: string; body: string; url: string; tag: string }): Promise<boolean> {
  if (typeof window === "undefined" || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.active) return false;
    reg.active.postMessage({ type: "schedule-timer", ...opts });
    return true;
  } catch { return false; }
}
export async function cancelTimerNotification(tag: string) {
  try { (await navigator.serviceWorker?.ready)?.active?.postMessage({ type: "cancel-timer", tag }); } catch { /* لا شيء */ }
}
