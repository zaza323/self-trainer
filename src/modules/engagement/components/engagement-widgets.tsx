"use client";
import { useActionState, useState } from "react";
import { dndAction, retroCompletionAction, classifyReturnAction } from "../actions";
import { Alert, Button, Card, CardContent, Input, Label } from "@/shared/ui";
import content from "@content/engagement.ar.json";

/** و.5 «لا تزعجني». */
export function DndButton({ active }: { active: boolean }) {
  const [, act, pending] = useActionState(dndAction, null);
  const [open, setOpen] = useState(false);
  if (active) return <form action={act}><input type="hidden" name="kind" value="end" /><Button size="sm" variant="outline" type="submit" disabled={pending}>{content.dnd.active} · {content.dnd.end}</Button></form>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen((v) => !v)}>{content.dnd.button}</Button>
      {open && (["1h", "2h", "until_task", "until_tomorrow"] as const).map((k) => <form key={k} action={act}><input type="hidden" name="kind" value={k} /><Button size="sm" variant="outline" type="submit" disabled={pending}>{content.dnd[k]}</Button></form>)}
    </div>
  );
}

/** P44/P45: العودة بعد غياب ≥ 8 ساعات — «عملت شي مش بالجدول؟» ثم «سجّل إنجاز» والتصنيف بلا عتاب. */
export function ReturnFlow({ absenceHours, scheduledCount, doneCount }: { absenceHours: number; scheduledCount: number; doneCount: number }) {
  const [r, retroAct, saving] = useActionState(retroCompletionAction, null);
  const [c, classifyAct, classifying] = useActionState(classifyReturnAction, null);
  const [mode, setMode] = useState<"ask" | "retro" | "done">("ask");
  const result = (r?.ok && (r.data as { classification?: string | null })?.classification) || (c?.ok && (c.data as { classification?: string | null })?.classification) || null;
  return (
    <Card className="border-primary/40"><CardContent className="space-y-2 p-4" data-testid="return-flow">
      <p className="font-medium">{content.return.title}</p>
      {mode === "ask" && <><p className="text-sm">{content.return.question}</p><div className="flex gap-2">
        <Button size="sm" type="button" onClick={() => setMode("retro")}>{content.return.yes}</Button>
        <form action={classifyAct}><input type="hidden" name="absence_hours" value={absenceHours} /><input type="hidden" name="scheduled" value={scheduledCount} /><input type="hidden" name="done" value={doneCount} /><Button size="sm" variant="outline" type="submit" disabled={classifying} onClick={() => setMode("done")}>{content.return.no}</Button></form>
      </div></>}
      {mode === "retro" && <form action={retroAct} className="space-y-2" onSubmit={() => setMode("done")}>
        <input type="hidden" name="absence_hours" value={absenceHours} /><input type="hidden" name="scheduled" value={scheduledCount} /><input type="hidden" name="done" value={doneCount} />
        <div><Label htmlFor="rt">{content.retro.what}</Label><Input id="rt" name="title" maxLength={200} required /></div>
        <div><Label htmlFor="ra">{content.retro.when}</Label><Input id="ra" name="approx_at" type="datetime-local" dir="ltr" required /></div>
        <p className="text-xs text-muted-foreground">{content.retro.no_xp}</p>
        <Button size="sm" type="submit" disabled={saving}>{content.retro.save}</Button>
      </form>}
      {mode === "done" && result && <Alert variant={result === "productive" ? "success" : "info"} className="text-sm">{result === "productive" ? content.return.productive : content.return.unproductive}</Alert>}
      {mode === "done" && !result && (r?.ok || c?.ok) && <Alert className="text-sm">{content.retro.saved}</Alert>}
    </CardContent></Card>
  );
}

export function RetroForm() {
  const [s, act, pending] = useActionState(retroCompletionAction, null);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <div><Label htmlFor="rt2">{content.retro.what}</Label><Input id="rt2" name="title" maxLength={200} required /></div>
      <div><Label htmlFor="ra2">{content.retro.when}</Label><Input id="ra2" name="approx_at" type="datetime-local" dir="ltr" required /></div>
      <Button size="sm" type="submit" disabled={pending}>{content.retro.save}</Button>
      {s?.ok && <span className="text-xs text-muted-foreground">{content.retro.saved}</span>}
    </form>
  );
}
