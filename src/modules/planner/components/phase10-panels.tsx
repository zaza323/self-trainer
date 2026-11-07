"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { createHabitAction, checkinHabitAction, archiveHabitAction, startFocusAction, endFocusAction, focusDistractionAction, createBlockAction, deleteBlockAction, setKanbanColumnAction, setQuadrantAction, weeklyReviewStepAction, type Res } from "../actions-phase10";
import type { HabitView } from "../habits-service";
import type { BlockRow } from "../blocks-service";
import type { PlannerTaskRow, PlannerSectionRow } from "../types";
import type { FocusSessionRow } from "../focus-service";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { plannerContent as c, fillLabel } from "../labels";
import { CAPABILITY_IDS, planner } from "@/shared/config";
import capNames from "@content/capabilities.ar.json";
import restContent from "@content/rest_activities.ar.json";

const Err = ({ s }: { s: Res | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{(c.refusals as Record<string, string>)[s.error] ?? s.error}</Alert> : null);

/** P30 العادات: تسجيل بلمسة؛ نسبة الالتزام أولًا، أفضل سلسلة بوضوح، الحالية أصغر؛ بلا عقوبة. */
export function HabitsPanel({ habits }: { habits: HabitView[] }) {
  const [cs, createAct, creating] = useActionState(createHabitAction, null);
  const [ks, checkAct, checking] = useActionState(checkinHabitAction, null);
  const [, archAct] = useActionState(archiveHabitAction, null);
  const [kind, setKind] = useState("daily");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{c.habits.no_penalty}</p>
      <ul className="space-y-2">
        {habits.map((h) => (
          <li key={h.id} className="rounded-xl border p-3" data-testid={`habit-${h.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <strong>{h.title}</strong>
              <Badge variant="secondary">{c.habits.adherence}: {Math.round(h.adherence * 100)}%</Badge>
              <Badge variant="success">{c.habits.best_streak}: {h.best} {c.habits.days}</Badge>
              <span className="text-xs text-muted-foreground">{c.habits.current_streak}: {h.current}</span>
              {!h.scheduledToday && <span className="text-xs text-muted-foreground">{c.habits.not_today}</span>}
              <form action={checkAct}><input type="hidden" name="habit_id" value={h.id} /><input type="hidden" name="done" value={h.doneToday ? "false" : "true"} /><Button size="sm" variant={h.doneToday ? "outline" : "default"} type="submit" disabled={checking}>{h.doneToday ? c.habits.undo : c.habits.checkin}</Button></form>
              <form action={archAct}><input type="hidden" name="habit_id" value={h.id} /><Button size="sm" variant="ghost" type="submit">{c.habits.archive}</Button></form>
            </div>
          </li>
        ))}
      </ul>
      <Err s={ks} />
      <Card><CardHeader><CardTitle className="text-base">{c.habits.new}</CardTitle></CardHeader><CardContent>
        <form action={createAct} className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-3"><Label htmlFor="ht">{c.habits.name}</Label><Input id="ht" name="title" maxLength={120} required /></div>
          <div><Label htmlFor="hk">{c.habits.kind}</Label><Select id="hk" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="daily">{c.habits.daily}</option><option value="weekdays_set">{c.habits.weekdays_set}</option><option value="times_per_week">{c.habits.times_per_week}</option></Select></div>
          {kind === "weekdays_set" && <div className="sm:col-span-2 flex flex-wrap gap-2">{c.weekdays.map((d, i) => <label key={i} className="flex items-center gap-1 text-sm"><input type="checkbox" name="days" value={i} /> {d}</label>)}</div>}
          {kind === "times_per_week" && <div><Label htmlFor="hn">{c.habits.times}</Label><Input id="hn" name="times" type="number" dir="ltr" min={1} max={7} defaultValue={3} /></div>}
          <div><Label htmlFor="htm">{c.habits.time}</Label><Input id="htm" name="time_local" type="time" dir="ltr" /></div>
          <div><Label htmlFor="hd">{c.habits.duration}</Label><Input id="hd" name="duration_min" type="number" dir="ltr" min={1} /></div>
          <div><Label htmlFor="hc">{c.habits.capability}</Label><Select id="hc" name="capability_id"><option value="">—</option>{CAPABILITY_IDS.map((k) => <option key={k} value={k}>{(capNames as unknown as Record<string, { name: string }>)[k]?.name ?? k}</option>)}</Select></div>
          <div className="flex items-end"><Button size="sm" type="submit" disabled={creating}>{c.habits.save}</Button></div>
        </form><Err s={cs} />
      </CardContent></Card>
    </div>
  );
}

/** P29 وضع «مهمة وحدة الآن»: شاشة كاملة بمهمة واحدة ومؤقت، زر «تشتّت» ثم «رجعت؟»؛ بعدها الاستراحة باقتراح من قائمة الراحة. */
export function FocusMode({ active, task, focusMin, tasks }: { active: FocusSessionRow | null; task: PlannerTaskRow | null; focusMin: number; tasks: PlannerTaskRow[] }) {
  const [ss, startAct, starting] = useActionState(startFocusAction, null);
  const [es, endAct, ending] = useActionState(endFocusAction, null);
  const [, distAct] = useActionState(focusDistractionAction, null);
  const [left, setLeft] = useState(() => active ? Math.max(0, focusMin * 60 - Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000)) : focusMin * 60);
  const [askReturn, setAskReturn] = useState(false);
  useEffect(() => { if (!active) return; const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000); return () => clearInterval(id); }, [active]);
  const result = es?.ok ? (es.data as { minutes: number; xp: number; break: { kind: "short" | "long"; minutes: number; suggestedActivities: string[] } }) : null;
  if (result) return (
    <Card data-testid="focus-done"><CardContent className="space-y-2 p-4 text-center">
      <p className="font-medium">{c.focus.done}</p><p className="text-sm">{fillLabel(c.focus.minutes_logged, { m: result.minutes })}</p>
      <p className="text-sm">{result.break.kind === "long" ? fillLabel(c.focus.break_long, { m: result.break.minutes }) : fillLabel(c.focus.break_short, { m: result.break.minutes })}</p>
      <p className="text-xs text-muted-foreground">{c.focus.break_hint} {result.break.suggestedActivities.map((k) => (restContent.activities as Record<string, { name: string }>)[k]?.name ?? k).join("، ")}</p>
      <div className="flex justify-center gap-2"><Button size="sm" asChild><Link href={`/app/rest?source=pomodoro&gap=${result.break.minutes}&break=${result.break.kind}`}>{restContent.title}</Link></Button><Button size="sm" variant="outline" asChild><Link href="/app">{c.task.details === "" ? "" : "التالي"}</Link></Button></div>
    </CardContent></Card>
  );
  if (!active) return (
    <Card><CardHeader><CardTitle className="text-base">{c.focus.title}</CardTitle></CardHeader><CardContent>
      <form action={startAct} className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor="ft">{c.focus.pick_task}</Label><Select id="ft" name="task_id" defaultValue={task?.id ?? ""}><option value="">{c.focus.no_task}</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select></div>
        <Button type="submit" disabled={starting}>{c.focus.start}</Button>
      </form><Err s={ss} />
    </CardContent></Card>
  );
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss2 = String(left % 60).padStart(2, "0");
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 rounded-2xl bg-neutral-900 p-6 text-neutral-100" data-testid="focus-mode">
      <h2 className="text-xl">{task?.title ?? c.focus.session}</h2>
      <div className="font-mono text-6xl" dir="ltr">{mm}:{ss2}</div>
      {!askReturn ? <Button variant="outline" type="button" onClick={() => { const fd = new FormData(); fd.set("session_id", active.id); fd.set("returned", "null"); distAct(fd); setAskReturn(true); }}>{c.focus.distraction}</Button>
        : <div className="space-y-2 text-center"><p>{c.focus.returned_q}</p><div className="flex gap-2"><Button type="button" onClick={() => { const fd = new FormData(); fd.set("session_id", active.id); fd.set("returned", "true"); distAct(fd); setAskReturn(false); }}>{c.focus.returned_yes}</Button><form action={endAct}><input type="hidden" name="session_id" value={active.id} /><input type="hidden" name="completed" value="false" /><Button variant="ghost" type="submit">{c.focus.returned_no}</Button></form></div></div>}
      <form action={endAct}><input type="hidden" name="session_id" value={active.id} /><input type="hidden" name="completed" value={left === 0 ? "true" : "false"} /><Button type="submit" disabled={ending}>{c.focus.finish}</Button></form>
    </div>
  );
}

/** P26 التقويم (يوم/أسبوع) + Time Blocking: التعارض يُعلَّم ولا يُمنع. */
export function CalendarView({ days, tasks, blocks, tz, canBlock, view }: { days: string[]; tasks: PlannerTaskRow[]; blocks: BlockRow[]; tz: string; canBlock: boolean; view: "day" | "week" | "month" }) {
  const [bs, blockAct, saving] = useActionState(createBlockAction, null);
  const [, delAct] = useActionState(deleteBlockAction, null);
  const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const dateOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${view === "day" ? "" : view === "week" ? "sm:grid-cols-7" : "sm:grid-cols-7"}`}>
        {days.map((d) => (
          <Card key={d}><CardContent className="space-y-1 p-2 text-xs">
            <div className="font-medium" dir="ltr">{d}</div>
            {tasks.filter((t) => t.due_date === d && t.status === "open").map((t) => <div key={t.id}>• <Link className="underline" href={`/app/planner/${t.id}`}>{t.title}</Link>{t.due_time && <span dir="ltr"> {t.due_time.slice(0, 5)}</span>}</div>)}
            {blocks.filter((b) => dateOf(b.starts_at) === d).map((b) => <div key={b.id} className="rounded bg-primary/10 px-1"><span dir="ltr">{hhmm(b.starts_at)}–{hhmm(b.ends_at)}</span> {b.task_id ? titles.get(b.task_id) ?? "" : ""} {b.kept === true ? `(${c.calendar.kept})` : b.kept === false ? `(${c.calendar.not_kept})` : ""}{canBlock && <form action={delAct} className="inline"><input type="hidden" name="block_id" value={b.id} /><button type="submit" className="ms-1 text-muted-foreground" aria-label={c.calendar.delete}>×</button></form>}</div>)}
          </CardContent></Card>
        ))}
      </div>
      {canBlock && (
        <Card><CardHeader><CardTitle className="text-base">{c.calendar.new_block}</CardTitle></CardHeader><CardContent>
          <form action={blockAct} className="grid gap-2 sm:grid-cols-4">
            <div><Label htmlFor="bt">{c.calendar.task}</Label><Select id="bt" name="task_id"><option value="">—</option>{tasks.filter((t) => t.status === "open").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select></div>
            <div><Label htmlFor="bsa">{c.calendar.starts}</Label><Input id="bsa" name="starts_at" type="datetime-local" dir="ltr" required /></div>
            <div><Label htmlFor="bea">{c.calendar.ends}</Label><Input id="bea" name="ends_at" type="datetime-local" dir="ltr" required /></div>
            <div className="flex items-end"><Button size="sm" type="submit" disabled={saving}>{c.calendar.save}</Button></div>
          </form>
          {bs?.ok && (bs.data as { conflicts: number }).conflicts > 0 && <Alert variant="warning" className="text-sm">{fillLabel(c.calendar.conflict, { n: (bs.data as { conflicts: number }).conflicts })}</Alert>}
          <Err s={bs} />
        </CardContent></Card>
      )}
    </div>
  );
}

/** P27 Kanban: الأعمدة بالحالة أو الأقسام؛ النقل باختيار (لا سحب). */
export function KanbanBoard({ tasks, sections }: { tasks: PlannerTaskRow[]; sections: PlannerSectionRow[] }) {
  const [, act] = useActionState(setKanbanColumnAction, null);
  const columns = sections.length ? sections.map((s) => s.name) : [c.status.open, c.status.done];
  const colOf = (t: PlannerTaskRow) => t.kanban_column ?? (sections.length ? (sections.find((s) => s.id === t.section_id)?.name ?? columns[0]!) : t.status === "done" ? c.status.done : c.status.open);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {columns.map((col) => (
        <Card key={col}><CardHeader><CardTitle className="text-sm">{col}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
          {tasks.filter((t) => colOf(t) === col).map((t) => <div key={t.id} className="rounded-lg border p-2"><Link className="underline" href={`/app/planner/${t.id}`}>{t.title}</Link>
            <form action={act} className="mt-1"><input type="hidden" name="task_id" value={t.id} /><Select name="column" defaultValue={col} onChange={(e) => e.target.form?.requestSubmit()} className="min-h-8 text-xs">{columns.map((x) => <option key={x} value={x}>{c.kanban.move} {x}</option>)}</Select></form></div>)}
        </CardContent></Card>
      ))}
    </div>
  );
}

/** P28 مصفوفة أيزنهاور: أربعة أرباع؛ لا أدلة من الترتيب نفسه. */
export function Eisenhower({ tasks }: { tasks: PlannerTaskRow[] }) {
  const [, act] = useActionState(setQuadrantAction, null);
  const quads: Array<{ key: string; important: boolean; urgent: boolean; label: string }> = [{ key: "q1", important: true, urgent: true, label: c.eisenhower.q1 }, { key: "q2", important: true, urgent: false, label: c.eisenhower.q2 }, { key: "q3", important: false, urgent: true, label: c.eisenhower.q3 }, { key: "q4", important: false, urgent: false, label: c.eisenhower.q4 }];
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{c.eisenhower.no_evidence}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {quads.map((q) => (
          <Card key={q.key}><CardHeader><CardTitle className="text-sm">{q.label}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
            {tasks.filter((t) => t.important === q.important && t.urgent === q.urgent).map((t) => <div key={t.id} className="flex flex-wrap items-center gap-1 rounded-lg border p-2"><Link className="underline" href={`/app/planner/${t.id}`}>{t.title}</Link>
              {quads.filter((x) => x.key !== q.key).map((x) => <form key={x.key} action={act}><input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="important" value={String(x.important)} /><input type="hidden" name="urgent" value={String(x.urgent)} /><Button size="sm" variant="ghost" type="submit">→ {x.label}</Button></form>)}</div>)}
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}

/** P32 المراجعة الأسبوعية الموجّهة: ثلاث خطوات، الأخيرة كتابة دائمًا بكلمات المستخدم. */
export function ReviewFlow({ review, recurring }: { review: { done_summary: string | null; postponed_summary: string | null; next_priorities: Array<{ text: string }> }; recurring: string[] }) {
  const [s, act, pending] = useActionState(weeklyReviewStepAction, null);
  const step: "done" | "postponed" | "next" | "finished" = review.next_priorities.length ? "finished" : review.postponed_summary !== null ? "next" : review.done_summary !== null ? "postponed" : "done";
  if (step === "finished" || (s?.ok && (s.data as { completed?: boolean })?.completed)) return <Alert variant="success">{c.review.done} <Link className="underline" href="/app/mirror">{c.review.mirror_link}</Link></Alert>;
  return (
    <Card><CardHeader><CardTitle className="text-base">{step === "done" ? c.review.q_done : step === "postponed" ? c.review.q_postponed : c.review.q_next}</CardTitle><CardDescription>{c.review.intro}</CardDescription></CardHeader>
      <CardContent>
        {recurring.length > 0 && step === "postponed" && <Alert className="mb-2 text-sm">{fillLabel(c.review.recurring, { items: recurring.join("، ") })}</Alert>}
        <form action={act} className="space-y-2">
          <input type="hidden" name="step" value={step} />
          {step !== "next" ? <textarea name="text" rows={3} maxLength={2000} required className="w-full rounded-xl border border-input bg-background p-3" />
            : <div className="space-y-1">{["p1", "p2", "p3"].map((k, i) => <Input key={k} name={k} maxLength={200} required={i === 0} placeholder={`${i + 1}`} />)}</div>}
          <Button size="sm" type="submit" disabled={pending}>{step === "next" ? c.review.finish : c.review.save}</Button>
        </form>
        <Err s={s} />
      </CardContent></Card>
  );
}
export const focusDefaultMin = planner.focus;
