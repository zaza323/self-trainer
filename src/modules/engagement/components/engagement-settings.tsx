"use client";
import { useActionState } from "react";
import { deleteBusyWindowAction } from "../actions";
import { DndButton } from "./engagement-widgets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/engagement.ar.json";
import type { EngagementState } from "../state";

/** قسم «الإشعارات» في P17 (و.8): الحالة بلغة بسيطة (لا تصنيف)، نوافذ الانشغال، «لا تزعجني». */
export function EngagementSettings({ state, windows, dndActive }: { state: EngagementState; windows: Array<{ id: string; weekday: number; start_hour: number; end_hour: number; source: string }>; dndActive: boolean }) {
  const [, del] = useActionState(deleteBusyWindowAction, null);
  return (
    <Card><CardHeader><CardTitle className="text-base">{content.state.title}</CardTitle><CardDescription>{content.state[state]}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <DndButton active={dndActive} />
        <div><p className="text-sm font-medium">{content.busy_windows.title}</p><p className="text-xs text-muted-foreground">{content.busy_windows.intro}</p>
          {windows.length === 0 ? <p className="text-sm text-muted-foreground">{content.busy_windows.none}</p> : <ul className="space-y-1 text-sm">{windows.map((w) => <li key={w.id} className="flex items-center gap-2">{content.busy_windows.weekday[w.weekday]} <span dir="ltr">{w.start_hour}:00–{w.end_hour}:00</span><form action={del}><input type="hidden" name="id" value={w.id} /><button type="submit" className="text-xs text-muted-foreground underline">{content.busy_windows.delete}</button></form></li>)}</ul>}
        </div>
      </CardContent></Card>
  );
}
