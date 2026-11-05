"use client";
import Link from "next/link";
import { useActionState } from "react";
import { markNotificationRead } from "../actions";
import { Badge, Button, Card, CardContent } from "@/shared/ui";
import content from "@content/notifications.ar.json";

export type InboxItem = { id: string; type: string; title: string | null; body: string | null; url: string | null; scheduled_for: string; sent_at: string | null; read_at: string | null };

/** صندوق الإشعارات داخل التطبيق (P/G09): يعرض ما أُرسل وما هو مجدول، مع "علّم كمقروء". */
export function Inbox({ items }: { items: InboxItem[] }) {
  const [, act, pending] = useActionState(markNotificationRead, null);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{content.inbox.empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((n) => (
        <Card key={n.id} className={n.read_at ? "opacity-70" : ""}>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div>
              <div className="font-medium">{n.title ?? n.type}</div>
              {n.body && <div className="text-muted-foreground">{n.body}</div>}
              <div className="mt-1 flex gap-1"><Badge variant="muted">{n.sent_at ? content.inbox.sent : content.inbox.scheduled}</Badge><span className="text-xs text-muted-foreground" dir="ltr">{new Date(n.sent_at ?? n.scheduled_for).toLocaleString("ar")}</span></div>
            </div>
            <div className="flex gap-1">
              {n.url && <Button asChild size="sm" variant="outline"><Link href={n.url}>↗</Link></Button>}
              {!n.read_at && n.sent_at && <form action={act}><input type="hidden" name="id" value={n.id} /><Button type="submit" size="sm" variant="ghost" disabled={pending}>{content.inbox.mark_read}</Button></form>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
