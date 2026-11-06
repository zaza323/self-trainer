"use client";
import { useActionState } from "react";
import { updateTaskAction, addChecklistAction, toggleChecklistAction, addReminderAction, snoozeReminderAction, type PlannerActionResult } from "../actions";
import { plannerContent as c, recurrenceLabel, reminderOffsetLabel, fillLabel } from "../labels";
import { parseRRule } from "../recurrence";
import type { PlannerTaskRow, PlannerChecklistRow, PlannerReminderRow, PlannerProjectRow, PlannerSectionRow } from "../types";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { PLANNER_PRIORITIES, planner } from "@/shared/config";
import { TaskList } from "./task-list";
import { QuickAdd } from "./quick-add";
import type { ParseContext } from "../nlp";

const Err = ({ s }: { s: PlannerActionResult | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{(c.refusals as Record<string, string>)[s.error] ?? s.error}</Alert> : null);
const Ok = ({ s, text }: { s: PlannerActionResult | null; text: string }) => (s?.ok ? <Alert variant="success" className="text-sm">{text}</Alert> : null);

/** P25 تفاصيل المهمة: تعديل، مهام فرعية (عمق 1)، قائمة تحقق، تذكيرات + Snooze، التكرار والتقدير مقابل الفعلي. */
export function TaskDetail({ task, subtasks, checklist, reminders, projects, sections, ctx, canUseTier1, today, highlightReminder }: {
  task: PlannerTaskRow; subtasks: PlannerTaskRow[]; checklist: PlannerChecklistRow[]; reminders: PlannerReminderRow[]; projects: PlannerProjectRow[]; sections: PlannerSectionRow[];
  ctx: ParseContext; canUseTier1: boolean; today: string; highlightReminder: string | null;
}) {
  const [us, updateAct, updating] = useActionState(updateTaskAction, null);
  const [cs, checkAct, adding] = useActionState(addChecklistAction, null);
  const [, toggleAct] = useActionState(toggleChecklistAction, null);
  const [rs, remAct, addingRem] = useActionState(addReminderAction, null);
  const [ss, snoozeAct, snoozing] = useActionState(snoozeReminderAction, null);
  const rec = parseRRule(task.recurrence_rrule);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">{task.title} <Badge variant="outline">{c.status[task.status]}</Badge></CardTitle></CardHeader>
        <CardContent>
          <form action={updateAct} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="task_id" value={task.id} />
            <div className="sm:col-span-2"><Label htmlFor="title">{c.quick_add.chips.title}</Label><Input id="title" name="title" defaultValue={task.title} maxLength={200} required /></div>
            <div><Label htmlFor="due_date">{c.quick_add.chips.date}</Label><Input id="due_date" name="due_date" type="date" dir="ltr" defaultValue={task.due_date ?? ""} /></div>
            <div><Label htmlFor="due_time">{c.quick_add.chips.time}</Label><Input id="due_time" name="due_time" type="time" dir="ltr" defaultValue={task.due_time?.slice(0, 5) ?? ""} /></div>
            <div><Label htmlFor="priority">{c.quick_add.chips.priority}</Label><Select id="priority" name="priority" defaultValue={task.priority}>{PLANNER_PRIORITIES.map((p) => <option key={p} value={p}>{c.priority[p]}</option>)}</Select></div>
            <div><Label htmlFor="estimate_min">{c.quick_add.chips.estimate}</Label><Input id="estimate_min" name="estimate_min" type="number" dir="ltr" min={1} defaultValue={task.estimate_min ?? ""} /></div>
            {canUseTier1 && <div><Label htmlFor="project_id">{c.task.project}</Label><Select id="project_id" name="project_id" defaultValue={task.project_id ?? ""}><option value="">{c.task.no_project}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>}
            {canUseTier1 && sections.length > 0 && <div><Label htmlFor="section_id">{c.task.section}</Label><Select id="section_id" name="section_id" defaultValue={task.section_id ?? ""}><option value="">—</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>}
            <div className="sm:col-span-2"><Label htmlFor="notes">{c.task.notes}</Label><textarea id="notes" name="notes" defaultValue={task.notes ?? ""} rows={3} maxLength={2000} className="w-full rounded-xl border border-input bg-background p-3" /></div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <Button type="submit" size="sm" disabled={updating}>{c.task.save}</Button>
              <span className="text-xs text-muted-foreground">{c.quick_add.chips.recurrence}: {recurrenceLabel(rec, task.recur_from)}</span>
              {task.status === "done" && task.estimate_min && task.actual_min !== null && <span className="text-xs">{fillLabel(c.task.estimate_vs_actual, { e: task.estimate_min, a: task.actual_min })}</span>}
            </div>
          </form>
          <Ok s={us} text={c.task.saved} /><Err s={us} />
        </CardContent>
      </Card>

      {!task.parent_task_id && (
        <Card id="subtasks">
          <CardHeader><CardTitle className="text-base">{c.task.subtasks}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <TaskList tasks={subtasks} today={today} emptyText={c.empty.list} showPostpone={false} />
            <QuickAdd ctx={ctx} canUseTier1={false} parentTaskId={task.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{c.task.checklist}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <ul className="space-y-1">
            {checklist.map((i) => (
              <li key={i.id}><form action={toggleAct} className="flex items-center gap-2"><input type="hidden" name="id" value={i.id} /><input type="hidden" name="done" value={i.done ? "false" : "true"} /><button type="submit" className={`text-start ${i.done ? "line-through text-muted-foreground" : ""}`} aria-pressed={i.done}>{i.done ? "☑" : "☐"} {i.text}</button></form></li>
            ))}
          </ul>
          {checklist.length < planner.tasks.checklist_max_items && (
            <form action={checkAct} className="flex gap-2"><input type="hidden" name="task_id" value={task.id} /><Input name="text" maxLength={200} required aria-label={c.task.add_checklist} /><Button type="submit" size="sm" disabled={adding}>{c.task.add_checklist}</Button></form>
          )}
          <Err s={cs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{c.quick_add.chips.reminder}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2 text-sm">
            {reminders.map((r) => (
              <li key={r.id} className={`rounded-lg border p-2 ${highlightReminder === r.id ? "border-primary" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span>{r.kind === "relative" ? reminderOffsetLabel(r.offset_min ?? 0) : c.reminder.absolute}</span>
                  {r.at && <span dir="ltr" className="text-xs text-muted-foreground">{new Date(r.at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}</span>}
                  {r.important && <Badge variant="warning">{c.reminder.important}</Badge>}
                  {r.sent_at && !r.snoozed_until && <Badge variant="outline">{c.reminder.sent}</Badge>}
                  {r.snoozed_until && !r.sent_at && <Badge variant="secondary">{c.reminder.snoozed_until} {new Date(r.snoozed_until).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}</Badge>}
                </div>
                {r.sent_at && task.status === "open" && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {planner.reminders.snooze_options.map((o, i) => (
                      <form key={i} action={snoozeAct}><input type="hidden" name="reminder_id" value={r.id} /><input type="hidden" name="option" value={i} /><Button type="submit" size="sm" variant="outline" disabled={snoozing}>{c.reminder.snooze}: {"minutes" in o ? fillLabel(c.reminder.snooze_minutes, { m: o.minutes }) : fillLabel(c.reminder.snooze_tomorrow, { t: o.tomorrow_at })}</Button></form>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Err s={ss} />
          {reminders.length < planner.reminders.max_per_task && task.status === "open" && (
            <form action={remAct} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="task_id" value={task.id} />
              <div><Label htmlFor="rk">{c.reminder.relative}</Label>
                <Select id="rk" name="offset_min" className="max-w-48"><option value="0">{c.reminder.at_due}</option>{planner.reminders.relative_presets_min.map((m) => <option key={m} value={m}>{reminderOffsetLabel(m)}</option>)}</Select></div>
              <input type="hidden" name="kind" value="relative" />
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="important" /> {c.reminder.important}</label>
              <Button type="submit" size="sm" disabled={addingRem || !task.due_date}>{c.reminder.add}</Button>
              {!task.due_date && <span className="text-xs text-muted-foreground">{c.reminder.needs_due}</span>}
            </form>
          )}
          <Err s={rs} />
        </CardContent>
      </Card>
    </div>
  );
}
