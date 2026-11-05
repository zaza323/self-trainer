"use client";
import { useEffect, useState } from "react";
import { savePushSubscription, removePushSubscription } from "../actions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/notifications.ar.json";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** NOTIF-4: تفعيل إشعارات الجهاز (Web Push) لهذا المتصفح. المفتاح العام من NEXT_PUBLIC_VAPID_PUBLIC_KEY. */
export function PushToggle({ audience }: { audience: "player" | "guardian" }) {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "denied" | "busy">("loading");
  const [err, setErr] = useState<string | null>(null);
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !key) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [key]);
  const enable = async () => {
    setState("busy"); setErr(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key!) });
      const r = await savePushSubscription(sub.toJSON(), navigator.userAgent);
      if (!r.ok) { setErr(r.error); return setState("off"); }
      setState("on");
    } catch (e) { setErr(String((e as Error).message)); setState("off"); }
  };
  const disable = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    } finally { setState("off"); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{content.push.title}</CardTitle><CardDescription>{audience === "guardian" ? content.push.guardian_intro : content.push.intro}</CardDescription></CardHeader>
      <CardContent className="space-y-2">
        {state === "unsupported" && <Alert>{content.push.unsupported}</Alert>}
        {state === "denied" && <Alert variant="warning">{content.push.denied}</Alert>}
        {state === "on" && <div className="flex items-center gap-2 text-sm"><span>✓ {content.push.enabled}</span><Button size="sm" variant="ghost" onClick={disable}>{content.push.disable}</Button></div>}
        {(state === "off" || state === "busy") && <Button size="sm" onClick={enable} disabled={state === "busy"}>{content.push.enable}</Button>}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
