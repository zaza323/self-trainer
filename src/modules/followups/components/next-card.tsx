"use client";
import Link from "next/link";
import { useActionState } from "react";
import { startNextAction } from "../actions";
import type { NextDecision } from "../compute";
import { Button, Card, CardContent } from "@/shared/ui";
import content from "@content/followups.ar.json";

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const timeOf = (d: Date | string, tz: string) => new Intl.DateTimeFormat("ar", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(d));

/** P39/P40: «الحين» و«التالي» و«وقت فاضي» (د.4). عند L2+ تسأل «شو التالي؟» بخيارات، وعند L0–L1 تقترح مباشرة. */
export function NextCard({ decision, tz, fromFollowupId = null, gapMin }: { decision: NextDecision; tz: string; fromFollowupId?: string | null; gapMin: number | null }) {
  const [, act, pending] = useActionState(startNextAction, null);
  const c = content.next;
  const { card, mode } = decision;
  const start = (kind: string, id: string | null, suggestedBy: "app" | "user") => { const fd = new FormData(); fd.set("next_kind", kind); fd.set("next_item_id", id ?? ""); fd.set("suggested_by", suggestedBy); if (fromFollowupId) fd.set("from_followup_id", fromFollowupId); act(fd); };
  const restHref = `/app/rest?source=${card.kind === "free_gap" ? "free_gap" : card.kind === "all_done" ? "priorities_done" : "next"}${gapMin ? `&gap=${gapMin}` : ""}`;
  let text = "";
  switch (card.kind) {
    case "now": text = fill(c.now, { title: card.item.title, time: timeOf(card.untilLabel, tz) }); break;
    case "next": text = fill(c.next, { title: card.item.title, time: timeOf(card.item.startsAt, tz), min: card.minutesUntil }); break;
    case "free_gap": text = card.untilAt ? fill(c.free_gap, { time: timeOf(card.untilAt, tz) }) : c.free_gap_open; break;
    case "priority": text = fill(c.priority, { text: card.priority.text }); break;
    case "all_done": text = c.all_done; break;
    case "quiet": text = c.quiet; break;
    case "wind_down": text = c.wind_down; break;
    case "rest": text = c.rest; break;
    case "nothing": text = c.nothing; break;
  }
  return (
    <Card data-testid={`next-${card.kind}`}><CardContent className="space-y-2 p-4">
      <p className="font-medium">{mode === "ask" ? c.ask : text}</p>
      {mode === "ask" && <p className="text-sm text-muted-foreground">{text}</p>}
      <div className="flex flex-wrap gap-2">
        {mode === "ask" ? decision.askOptions.map((o) => o.kind === "rest"
          ? <Button key={o.id} size="sm" variant="outline" asChild><Link href={restHref}>{c.rest_time}</Link></Button>
          : <Button key={o.id} size="sm" variant="outline" type="button" disabled={pending} onClick={() => start(o.kind === "priority" ? "task" : o.kind, o.id.startsWith("p:") ? null : o.id, "user")}>{o.label}</Button>)
        : <>
          {(card.kind === "now" || card.kind === "next") && <Button size="sm" type="button" disabled={pending} onClick={() => start(card.item.kind, card.item.id, "app")}>{card.kind === "now" ? c.start_focus : c.start_now}</Button>}
          {card.kind === "now" && card.item.taskId && <Button size="sm" variant="outline" asChild><Link href={`/app/planner/focus?task=${card.item.taskId}`}>{c.start_focus}</Link></Button>}
          {card.kind === "next" && card.item.taskId && <Button size="sm" variant="ghost" asChild><Link href={`/app/planner/${card.item.taskId}`}>{c.remind_before}</Link></Button>}
          {card.kind === "priority" && <Button size="sm" type="button" disabled={pending} onClick={() => start("task", card.priority.id, "app")}>{c.start_now}</Button>}
          {card.kind === "free_gap" && card.topPriority && <Button size="sm" type="button" disabled={pending} onClick={() => start("task", card.topPriority!.id, "app")}>{fill(c.priority, { text: card.topPriority.text })}</Button>}
          {(card.kind === "free_gap" || card.kind === "all_done" || card.kind === "wind_down") && <Button size="sm" variant="outline" asChild><Link href={card.kind === "wind_down" ? "/app/rest?source=wind_down" : restHref}>{c.rest_time}</Link></Button>}
          {card.kind === "all_done" && <Button size="sm" variant="ghost" asChild><Link href="/app/planner">{c.add_something}</Link></Button>}
        </>}
      </div>
    </CardContent></Card>
  );
}
