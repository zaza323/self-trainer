"use client";
import { useActionState } from "react";
import { setTaskMarginAction, updateMarginRuleAction, type MarginActionResult } from "../actions";
import { Button, Input, Label } from "@/shared/ui";
import content from "@content/margins.ar.json";

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
const errText = (s: MarginActionResult | null) => (s && !s.ok ? (content.errors as Record<string, string>)[s.error] ?? content.errors.invalid_input : null);

export type MarginControlProps = {
  subjectType: "mission" | "planner_task"; subjectId: string; title: string;
  current: number; systemDefault: number; basis: string; sourceLabel: string | null;
  step: number; min: number; max: number; reasons: string[]; canLock: boolean; locked: boolean;
};

/** G17: «هامش الوقت» للمربي — الافتراضي وأساسه، محدد ±الخطوة، رموز السبب الاختيارية، ومفتاح «لهذه المهمة / لكل المشابهة». */
export function MarginControl(p: MarginControlProps) {
  const [state, action, pending] = useActionState(setTaskMarginAction, null);
  return (
    <form action={action} className="space-y-2 rounded-xl border p-3 text-sm">
      <input type="hidden" name="subject_type" value={p.subjectType} /><input type="hidden" name="subject_id" value={p.subjectId} />
      <div className="font-medium">{p.title}</div>
      <p className="text-muted-foreground">{fill(content.ui.default_is, { min: p.systemDefault })} · {p.basis}{p.sourceLabel ? ` · ${p.sourceLabel}` : ""}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor={`mc-${p.subjectId}`}>{content.ui.title} ({content.ui.minutes})</Label><Input id={`mc-${p.subjectId}`} name="minutes" type="number" dir="ltr" min={p.min} max={p.max} step={p.step} defaultValue={p.current} className="w-24" /></div>
        <select name="reason" defaultValue="" className="h-10 rounded-xl border bg-background px-2" aria-label={content.reasons.other}>
          <option value="">—</option>
          {p.reasons.map((r) => <option key={r} value={r}>{(content.reasons as Record<string, string>)[r] ?? r}</option>)}
        </select>
        <select name="apply_scope" defaultValue="this_task" className="h-10 rounded-xl border bg-background px-2" aria-label={content.ui.title}>
          <option value="this_task">{content.apply_scopes.this_task}</option><option value="all_similar">{content.apply_scopes.all_similar}</option>
        </select>
        <Button type="submit" size="sm" disabled={pending}>{content.ui.save}</Button>
      </div>
      {p.canLock && <label className="flex items-center gap-2"><input type="checkbox" name="lock" defaultChecked={p.locked} /> {content.ui.lock}</label>}
      {errText(state) && <p className="text-destructive">{errText(state)}</p>}
    </form>
  );
}

/** G18: قاعدة صريحة — تعديل أو إيقاف. */
export function MarginRuleRow({ id, label, minutes, step, min, max }: { id: string; label: string; minutes: number; step: number; min: number; max: number }) {
  const [state, action, pending] = useActionState(updateMarginRuleAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
      <input type="hidden" name="rule_id" value={id} />
      <span className="grow">{label}</span>
      <Input name="minutes" type="number" dir="ltr" min={min} max={max} step={step} defaultValue={minutes} className="w-24" aria-label={content.ui.title} />
      <Button type="submit" size="sm" disabled={pending}>{content.ui.save}</Button>
      <Button type="submit" name="stop" value="1" size="sm" variant="outline" disabled={pending}>{content.ui.stop_rule}</Button>
      {errText(state) && <p className="w-full text-destructive">{errText(state)}</p>}
    </form>
  );
}
