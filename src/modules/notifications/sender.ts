import "server-only";
import { limits } from "@/shared/config";

/** مرسل Web Push قابل للحقن: الحقيقي عبر web-push بمفاتيح VAPID من البيئة، والوهمي للاختبارات. */
export type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string; type: string; id: string };
export type SendOutcome = "ok" | "gone" | "error";
export type PushSender = { enabled: boolean; send: (sub: PushSubscriptionRow, payload: PushPayload) => Promise<SendOutcome> };

export function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

export function webPushSender(): PushSender {
  if (!vapidConfigured()) return { enabled: false, send: async () => "error" };
  return {
    enabled: true,
    async send(sub, payload) {
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: limits.notifications.push_ttl_seconds, urgency: "normal" });
        return "ok";
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return code === 404 || code === 410 ? "gone" : "error";
      }
    },
  };
}

export function fakeSender(outcome: SendOutcome | ((sub: PushSubscriptionRow) => SendOutcome) = "ok"): PushSender & { sent: Array<{ sub: PushSubscriptionRow; payload: PushPayload }> } {
  const sent: Array<{ sub: PushSubscriptionRow; payload: PushPayload }> = [];
  return { enabled: true, sent, async send(sub, payload) { sent.push({ sub, payload }); return typeof outcome === "function" ? outcome(sub) : outcome; } };
}
