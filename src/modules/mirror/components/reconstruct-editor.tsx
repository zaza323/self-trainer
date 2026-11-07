"use client";
import { useActionState } from "react";
import { addSegmentAction, removeSegmentAction, completeReconstructionAction } from "../actions";
import type { ActualBlockRow } from "../service";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import content from "@content/mirror.ar.json";

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const hhmm = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** P48 إعادة بناء اليوم: خط زمني بمقاطع مملوءة مسبقًا، أسئلة الفجوات بأزرار الفئات (+ «ما بتذكر»)، سؤال طاقة للمقاطع الطويلة، تقدير الشاشة. */
export function ReconstructEditor({ reconstructionId, date, blocks, gaps, categories, tz, completed, mirrorWeek, energyMinBlock }: { reconstructionId: string; date: string; blocks: ActualBlockRow[]; gaps: Array<{ start: string; end: string }>; categories: Array<{ key: string; label: string }>; tz: string; completed: boolean; mirrorWeek: boolean; energyMinBlock: number }) {
  const [a, addAct, adding] = useActionState(addSegmentAction, null);
  const [, rmAct] = useActionState(removeSegmentAction, null);
  const [c, doneAct, finishing] = useActionState(completeReconstructionAction, null);
  const label = (k: string) => categories.find((x) => x.key === k)?.label ?? k;
  const quick = (gap: { start: string; end: string }, category: string) => { const fd = new FormData(); fd.set("reconstruction_id", reconstructionId); fd.set("date", date); fd.set("from", hhmm(gap.start, tz)); fd.set("to", hhmm(gap.end, tz)); fd.set("category", category); addAct(fd); };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{content.reconstruct.intro} {mirrorWeek ? content.reconstruct.mirror_week_note : ""}</p>
      <Card><CardHeader><CardTitle className="text-base">{date}</CardTitle></CardHeader><CardContent>
        <ul className="space-y-1 text-sm" data-testid="timeline">
          {blocks.map((b) => <li key={b.id} className="flex items-center gap-2 rounded-lg border p-2"><span dir="ltr" className="text-xs text-muted-foreground">{hhmm(b.starts_at, tz)}–{hhmm(b.ends_at, tz)}</span><strong>{label(b.category)}</strong>{b.label && <span>· {b.label}</span>}{b.origin === "prefilled" && <span className="text-xs text-muted-foreground">({content.reconstruct.prefilled})</span>}{b.energy && <span className="text-xs">⚡{content.reconstruct.energy[b.energy]}</span>}
            {!completed && <form action={rmAct}><input type="hidden" name="id" value={b.id} /><button type="submit" className="text-muted-foreground" aria-label="×">×</button></form>}</li>)}
        </ul>
      </CardContent></Card>
      {!completed && gaps.map((g) => (
        <Card key={g.start} data-testid="gap"><CardContent className="space-y-2 p-3">
          <p className="text-sm font-medium">{fill(content.reconstruct.gap_question, { from: hhmm(g.start, tz), to: hhmm(g.end, tz) })}</p>
          <div className="flex flex-wrap gap-1">{categories.map((k) => <Button key={k.key} size="sm" variant={k.key === "unknown" ? "ghost" : "outline"} type="button" disabled={adding} onClick={() => quick(g, k.key)}>{k.key === "unknown" ? content.reconstruct.dont_remember : k.label}</Button>)}</div>
        </CardContent></Card>
      ))}
      {!completed && (
        <Card><CardHeader><CardTitle className="text-base">{content.reconstruct.add_segment}</CardTitle></CardHeader><CardContent>
          <form action={addAct} className="grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="reconstruction_id" value={reconstructionId} /><input type="hidden" name="date" value={date} />
            <div><Label htmlFor="f">{content.reconstruct.from}</Label><Input id="f" name="from" type="time" dir="ltr" required /></div>
            <div><Label htmlFor="t">{content.reconstruct.to}</Label><Input id="t" name="to" type="time" dir="ltr" required /></div>
            <div><Label htmlFor="cat">{content.reconstruct.category}</Label><Select id="cat" name="category">{categories.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select></div>
            <div><Label htmlFor="lb">{content.reconstruct.label}</Label><Input id="lb" name="label" maxLength={60} /></div>
            <div><Label htmlFor="en">{content.reconstruct.energy_question} (≥ {energyMinBlock} د)</Label><Select id="en" name="energy"><option value="">—</option>{(["high", "normal", "low"] as const).map((e) => <option key={e} value={e}>{content.reconstruct.energy[e]}</option>)}</Select></div>
            <div className="flex items-end"><Button size="sm" type="submit" disabled={adding}>{content.reconstruct.add_segment}</Button></div>
          </form>{a && !a.ok && <Alert variant="error" className="text-sm">{a.error}</Alert>}
        </CardContent></Card>
      )}
      {!completed && (
        <form action={doneAct} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="reconstruction_id" value={reconstructionId} />
          <div><Label htmlFor="sc">{content.reconstruct.screen_time}</Label><Input id="sc" name="screen_min" type="number" dir="ltr" min={0} placeholder="دقائق" /><p className="text-xs text-muted-foreground">{content.reconstruct.screen_hint}</p></div>
          <Button type="submit" size="sm" name="next" value="predict" disabled={finishing}>{content.reconstruct.complete}</Button>
          <Button type="submit" size="sm" variant="outline" disabled={finishing}>{content.reconstruct.complete} (بدون مرآة)</Button>
        </form>
      )}
      {(completed || c?.ok) && <Alert variant="success">{content.reconstruct.completed}</Alert>}
    </div>
  );
}
