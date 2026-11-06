"use client";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { completeTaskAction, postponeTaskAction, postponeAnswerAction, cancelTaskAction, reopenTaskAction, type PlannerActionResult } from "../actions";
import { plannerContent as c, priorityLabel, fillLabel } from "../labels";
import type { PlannerTaskRow } from "../types";
import { Alert, Badge, Button, Card, CardContent, Input, Label } from "@/shared/ui";

const Err = ({ s }: { s: PlannerActionResult | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{(c.refusals as Record<string, string>)[s.error] ?? s.error}</Alert> : null);

/** ب.8: سؤال التأجيل (choices_plus_other) مرة واحدة؛ كل خيار يقود لفعل. */
export function PostponePrompt({ taskId, onDone }: { taskId: string; onDone: (next: string) => void }) {
  const [s, act, pending] = useActionState(postponeAnswerAction, null);
  const [other, setOther] = useState(false);
  useEffect(() => { if (s?.ok) onDone(String((s.data as { next: string }).next)); }, [s, onDone]);
  const choose = (choice: string, text = "") => { const fd = new FormData(); fd.set("task_id", taskId); fd.set("choice", choice); fd.set("text", text); startTransition(() => act(fd)); };
  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-muted/40 p-3" data-testid="postpone-prompt">
      <p className="font-medium">{c.postpone_prompt.question}</p>
      <p className="text-xs text-muted-foreground">{c.postpone_prompt.hint}</p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(c.postpone_prompt.options).map(([k, label]) => <Button key={k} size="sm" variant="outline" type="button" disabled={pending} onClick={() => choose(k)}>{label}</Button>)}
        {!other && <Button size="sm" variant="ghost" type="button" onClick={() => setOther(true)}>{c.postpone_prompt.other}</Button>}
      </div>
      {other && <form onSubmit={(e) => { e.preventDefault(); choose("other", String(new FormData(e.currentTarget).get("text") ?? "")); }} className="flex gap-2"><Input name="text" maxLength={300} required /><Button size="sm" type="submit" disabled={pending}>{c.task.save}</Button></form>}
      <Err s={s} />
    </div>
  );
}

function TaskRow({ t, today, showPostpone }: { t: PlannerTaskRow; today: string; showPostpone: boolean }) {
  const [cs, completeAct, completing] = useActionState(completeTaskAction, null);
  const [ps, postponeAct, postponing] = useActionState(postponeTaskAction, null);
  const [, cancelAct, cancelling] = useActionState(cancelTaskAction, null);
  const [, reopenAct] = useActionState(reopenTaskAction, null);
  const [prompt, setPrompt] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [askActual, setAskActual] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  useEffect(() => { if (ps?.ok && (ps.data as { prompt?: boolean })?.prompt) setPrompt(true); }, [ps]);
  const postpone = (to: string) => { const fd = new FormData(); fd.set("task_id", t.id); fd.set("to", to); startTransition(() => postponeAct(fd)); };
  const overdue = t.status === "open" && t.due_date !== null && t.due_date < today;
  return (
    <li className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {t.status === "open" ? (
          <form action={completeAct} className="flex items-center gap-2">
            <input type="hidden" name="task_id" value={t.id} />
            {askActual && t.estimate_min ? <><Label htmlFor={`act-${t.id}`} className="text-xs">{c.task.actual_min}</Label><Input id={`act-${t.id}`} name="actual_min" type="number" dir="ltr" min={0} className="max-w-24" /></> : null}
            <Button type="submit" size="sm" disabled={completing} onClick={(e) => { if (t.estimate_min && !askActual) { e.preventDefault(); setAskActual(true); } }}>{c.task.complete}</Button>
          </form>
        ) : <form action={reopenAct}><input type="hidden" name="task_id" value={t.id} /><Button type="submit" size="sm" variant="ghost">{c.task.reopen}</Button></form>}
        <Link href={`/app/planner/${t.id}`} className={`font-medium ${t.status !== "open" ? "line-through text-muted-foreground" : ""}`}>{t.title}</Link>
        {t.priority !== "none" && <Badge variant={t.priority === "high" ? "warning" : "secondary"}>{priorityLabel(t.priority)}</Badge>}
        {t.due_date && <span className={`text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`} dir="ltr">{t.due_date}{t.due_time ? ` ${t.due_time.slice(0, 5)}` : ""}</span>}
        {t.recurrence_rrule && <Badge variant="outline">↻</Badge>}
        {t.created_via === "guardian" && <Badge variant="outline">{c.task.created_by_guardian}</Badge>}
        {t.postpone_count > 0 && <span className="text-xs text-muted-foreground">{fillLabel(c.task.postponed_times, { n: t.postpone_count })}</span>}
      </div>
      {t.status === "open" && showPostpone && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" type="button" disabled={postponing} onClick={() => postpone("today")}>{c.task.postpone_today}</Button>
          <Button size="sm" variant="outline" type="button" disabled={postponing} onClick={() => postpone("tomorrow")}>{c.task.postpone_tomorrow}</Button>
          <Input type="date" dir="ltr" className="max-w-40" aria-label={c.task.postpone_pick} onChange={(e) => { if (e.target.value) postpone(e.target.value); }} />
          <Button size="sm" variant="ghost" type="button" onClick={() => setCancelOpen((v) => !v)}>{c.task.cancel}</Button>
          <Button size="sm" variant="ghost" asChild><Link href={`/app/planner/${t.id}#subtasks`}>{c.task.split}</Link></Button>
        </div>
      )}
      {cancelOpen && (
        <form action={cancelAct} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="task_id" value={t.id} />
          <div className="grow"><Label htmlFor={`cr-${t.id}`}>{c.task.cancel_reason_label}</Label><Input id={`cr-${t.id}`} name="reason" maxLength={300} /></div>
          <Button type="submit" size="sm" variant="destructive" disabled={cancelling}>{c.task.cancel}</Button>
        </form>
      )}
      {prompt && <PostponePrompt taskId={t.id} onDone={(next) => { setPrompt(false); setHint((c.postpone_prompt.actions as Record<string, string>)[next] ?? null); }} />}
      {hint && <Alert className="text-sm">{hint}</Alert>}
      {cs?.ok && (cs.data as { nextTaskId?: string | null })?.nextTaskId && <Alert variant="success" className="text-sm">{c.task.recurring_next.replace("{date}", "")}</Alert>}
      <Err s={cs} /><Err s={ps} />
    </li>
  );
}

export function TaskList({ tasks, today, emptyText, showPostpone = true }: { tasks: PlannerTaskRow[]; today: string; emptyText: string; showPostpone?: boolean }) {
  if (tasks.length === 0) return <Card><CardContent className="p-4 text-sm text-muted-foreground">{emptyText}</CardContent></Card>;
  return <ul className="space-y-2">{tasks.map((t) => <TaskRow key={t.id} t={t} today={today} showPostpone={showPostpone} />)}</ul>;
}
