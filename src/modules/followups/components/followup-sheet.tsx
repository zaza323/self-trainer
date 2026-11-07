"use client";
import { useActionState, useState } from "react";
import { answerFollowupAction, type Res } from "../actions";
import type { FollowupView } from "../service";
import { Alert, Button, Card, CardContent, Input, Label } from "@/shared/ui";
import content from "@content/followups.ar.json";

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat("ar", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** P38 ورقة «تمّت؟» (مفردة حتى 3 متتالية؛ أكثر ⇒ قائمة واحدة بخانات). بلا لوم وبلا عقوبة. */
export function FollowupSheet({ items, presentation, tz, askDurationFeel, onDone }: { items: FollowupView[]; presentation: "sheets" | "list"; tz: string; askDurationFeel: boolean; onDone?: () => void }) {
  const [s, act, pending] = useActionState(answerFollowupAction, null);
  const [idx, setIdx] = useState(0);
  const [branch, setBranch] = useState<"none" | "partial" | "missed" | "postponed" | "feel">("none");
  const [doneAll, setDoneAll] = useState(false);
  const Err = ({ s }: { s: Res | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{s.error}</Alert> : null);
  if (presentation === "list") {
    return (
      <Card className="border-primary/40"><CardContent className="space-y-2 p-4" data-testid="followup-list">
        <p className="font-medium">{fill(content.sheet.list_title, { n: items.length })}</p>
        <form action={act} className="space-y-2" onSubmit={() => setDoneAll(true)}>
          {items.map((f) => <label key={f.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="followup_id" value={f.id} defaultChecked /> {f.title} <span className="text-xs text-muted-foreground" dir="ltr">{timeOf(f.startsAt, tz)}</span></label>)}
          <input type="hidden" name="reply" value="done" />
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={pending}>{content.sheet.all_done}</Button></div>
        </form>
        <form action={act}><input type="hidden" name="reply" value="snoozed" />{items.map((f) => <input key={f.id} type="hidden" name="followup_id" value={f.id} />)}<Button type="submit" size="sm" variant="ghost">{content.sheet.later}</Button></form>
        <p className="text-xs text-muted-foreground">{content.no_blame}</p>
        {s?.ok && doneAll && <Alert variant="success" className="text-sm">{content.xp_note}</Alert>}
        <Err s={s} />
      </CardContent></Card>
    );
  }
  const f = items[idx];
  if (!f) { onDone?.(); return null; }
  const submit = (reply: string, extra: Record<string, string> = {}) => { const fd = new FormData(); fd.set("followup_id", f.id); fd.set("reply", reply); for (const [k, v] of Object.entries(extra)) fd.set(k, v); act(fd); setBranch(reply === "done" && askDurationFeel && f.estimateMin ? "feel" : "none"); if (!(reply === "done" && askDurationFeel && f.estimateMin)) setIdx((i) => i + 1); };
  return (
    <Card className="border-primary/40"><CardContent className="space-y-2 p-4" data-testid="followup-sheet">
      <p className="font-medium">{fill(content.sheet.title, { title: f.title, time: timeOf(f.startsAt, tz) })}</p>
      {branch === "none" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="button" disabled={pending} onClick={() => submit("done")}>{content.replies.done}</Button>
          <Button size="sm" type="button" variant="outline" onClick={() => setBranch("partial")}>{content.replies.partial}</Button>
          <Button size="sm" type="button" variant="outline" onClick={() => setBranch("missed")}>{content.replies.missed}</Button>
          <Button size="sm" type="button" variant="outline" onClick={() => setBranch("postponed")}>{content.replies.postponed}</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => submit("snoozed")}>{content.sheet.later}</Button>
        </div>
      )}
      {branch === "partial" && <div className="space-y-1"><p className="text-sm">{content.partial_question}</p><div className="flex gap-2"><Button size="sm" type="button" onClick={() => submit("partial", { postpone_to: "today" })}>{content.replies.done === "" ? "" : "اليوم"}</Button><Button size="sm" type="button" variant="outline" onClick={() => submit("partial", { postpone_to: "tomorrow" })}>{content.missed_options.tomorrow}</Button></div></div>}
      {branch === "missed" && <div className="space-y-1"><p className="text-xs text-muted-foreground">{content.no_blame}</p><div className="flex flex-wrap gap-2"><Button size="sm" type="button" onClick={() => submit("missed", { postpone_to: "tomorrow" })}>{content.missed_options.tomorrow}</Button><Input type="date" dir="ltr" className="max-w-40" aria-label={content.missed_options.pick_time} onChange={(e) => { if (e.target.value) submit("missed", { postpone_to: e.target.value }); }} /><Button size="sm" type="button" variant="ghost" onClick={() => submit("missed", { postpone_to: "cancel" })}>{content.missed_options.cancel}</Button></div></div>}
      {branch === "postponed" && <div className="flex items-end gap-2"><div><Label htmlFor={`pd-${f.id}`}>{content.missed_options.pick_time}</Label><Input id={`pd-${f.id}`} type="date" dir="ltr" onChange={(e) => { if (e.target.value) submit("postponed", { postpone_to: e.target.value }); }} /></div><Button size="sm" type="button" variant="outline" onClick={() => submit("postponed", { postpone_to: "" })}>{content.missed_options.tomorrow}</Button></div>}
      {branch === "feel" && <div className="space-y-1"><p className="text-sm">{content.duration_feel.question}</p><div className="flex gap-2">{(["less", "about", "more"] as const).map((k) => <form key={k} action={act}><input type="hidden" name="followup_id" value={f.id} /><input type="hidden" name="reply" value="done" /><input type="hidden" name="duration_feel" value={k} /><Button size="sm" type="submit" variant="outline" onClick={() => { setBranch("none"); setIdx((i) => i + 1); }}>{content.duration_feel[k]}</Button></form>)}</div></div>}
      <Err s={s} />
    </CardContent></Card>
  );
}
