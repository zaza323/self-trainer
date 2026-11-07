"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { muhasabaStepAction, muhasabaReasonAction } from "../actions";
import type { MuhasabaView } from "../service";
import { muhasabaShortfallMax } from "@/modules/planner/evidence-values";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import content from "@content/muhasaba.ar.json";
import type { AgeMode } from "@/shared/config";

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

/** P46 محاسبة النفس: ثلاث خطوات بشريط تقدم صغير، تنتهي دائمًا بالخطوة القادمة، ثم الختام. */
export function MuhasabaFlow({ view, ageMode, alreadyDone }: { view: MuhasabaView; ageMode: AgeMode; alreadyDone: boolean }) {
  const [s, act, pending] = useActionState(muhasabaStepAction, null);
  const [r, reasonAct, asking] = useActionState(muhasabaReasonAction, null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<Array<{ text: string; task_id: string | null }>>([]);
  const steps = view.steps;
  const step = steps[i];
  const done = alreadyDone || (s?.ok && (s.data as { completed?: boolean })?.completed);
  const q = (k: string) => (content.steps as Record<string, { question: Record<AgeMode, string> }>)[k]?.question[ageMode] ?? "";
  if (done) return <Card data-testid="muhasaba-closing"><CardContent className="space-y-2 p-4 text-center"><p className="text-lg">{content.closing[ageMode]}</p><Button asChild size="sm"><Link href="/app">{content.finish}</Link></Button></CardContent></Card>;
  if (!step) return null;
  const Progress = () => <p className="text-xs text-muted-foreground">{fill(content.progress, { i: i + 1, n: steps.length })}</p>;
  const next = () => setI((x) => Math.min(steps.length - 1, x + 1));
  const Err = () => (s && !s.ok ? <Alert variant="error" className="text-sm">{s.error}</Alert> : null);
  return (
    <Card data-testid={`muhasaba-${step}`}>
      <CardHeader><CardTitle className="text-base">{q(step)}</CardTitle><Progress />{view.restDay && <p className="text-xs text-muted-foreground">{content.rest_day_note}</p>}</CardHeader>
      <CardContent className="space-y-3">
        {(step === "achieved" || step === "did_well") && (
          <form action={act} className="space-y-2" onSubmit={next}>
            <input type="hidden" name="entry_id" value={view.entry.id} /><input type="hidden" name="step" value={step} />
            <ul className="space-y-1 text-sm">{view.suggestedAchieved.length ? view.suggestedAchieved.map((a, k) => <li key={k}><label className="flex items-center gap-2"><input type="checkbox" name="achieved" value={a.text} defaultChecked /> {a.text}</label></li>) : <li className="text-muted-foreground">{content.steps.achieved.none}</li>}</ul>
            <div><Label htmlFor="add">{content.steps.achieved.add_label}</Label><Input id="add" name="achieved" maxLength={200} /></div>
            <Button size="sm" type="submit" disabled={pending}>{content.continue}</Button>
          </form>
        )}
        {step === "shortfall" && (
          <form action={act} className="space-y-2" onSubmit={(e) => { if (picked.length > muhasabaShortfallMax) e.preventDefault(); else next(); }}>
            <input type="hidden" name="entry_id" value={view.entry.id} /><input type="hidden" name="step" value="shortfall" />
            <Label>{content.steps.shortfall.pick_label}</Label>
            <ul className="space-y-1 text-sm">{view.suggestedShortfalls.map((x, k) => <li key={k}><label className="flex items-center gap-2"><input type="checkbox" checked={picked.some((p) => (p.task_id ?? p.text) === (x.task_id ?? x.text))} onChange={(e) => setPicked((ps) => e.target.checked ? (ps.length < muhasabaShortfallMax ? [...ps, x] : ps) : ps.filter((p) => (p.task_id ?? p.text) !== (x.task_id ?? x.text)))} /> {x.text}</label></li>)}</ul>
            {picked.length < muhasabaShortfallMax && <Input placeholder={content.steps.shortfall.pick_label} maxLength={200} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v) { setPicked((ps) => [...ps, { text: v, task_id: null }]); (e.target as HTMLInputElement).value = ""; } } }} />}
            {picked.map((p, k) => <div key={k} className="rounded-xl border p-2"><input type="hidden" name="sf_text" value={p.text} /><input type="hidden" name="sf_task" value={p.task_id ?? ""} /><Label htmlFor={`r-${k}`}>{p.text} — {content.steps.shortfall.reason_label}</Label><Input id={`r-${k}`} name="sf_reason" maxLength={300} placeholder={content.steps.shortfall.reason_hint} /></div>)}
            {picked.length > 0 && <div className="flex flex-wrap items-end gap-2"><Button size="sm" type="button" variant="outline" disabled={asking} onClick={() => { const fd = new FormData(); fd.set("entry_id", view.entry.id); fd.set("shortfall", picked[0]!.text); const el = document.getElementById("r-0") as HTMLInputElement | null; fd.set("reason", el?.value ?? ""); if (el?.value) reasonAct(fd); }}>{"المرافق"}</Button>{r?.ok && <Alert className="text-sm" data-testid="muhasaba-reply">{(r.data as { reply: string }).reply}</Alert>}</div>}
            <Button size="sm" type="submit" disabled={pending}>{content.continue}</Button><Err />
          </form>
        )}
        {(step === "next" || step === "do_better_tomorrow") && (
          <form action={act} className="space-y-2">
            <input type="hidden" name="entry_id" value={view.entry.id} /><input type="hidden" name="step" value={step} />
            <Label>{content.steps.next.pick_label}</Label>
            <ul className="space-y-1 text-sm">{view.candidateNext.map((x, k) => <li key={k}><label className="flex items-center gap-2"><input type="checkbox" name="next_text" value={x.text} /><input type="hidden" name="next_task" value={x.task_id ?? ""} /> {x.text}</label></li>)}</ul>
            <div><Label htmlFor="nx">{content.steps.next.free_label}</Label><Input id="nx" name="next_text" maxLength={200} /><input type="hidden" name="next_task" value="" /></div>
            <Button size="sm" type="submit" disabled={pending}>{content.finish}</Button><Err />
          </form>
        )}
      </CardContent>
    </Card>
  );
}
