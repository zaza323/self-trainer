"use client";
import { useActionState, useEffect, useState } from "react";
import { setTaskMarginAction, extendMarginAction, type MarginActionResult } from "../actions";
import { Button, Card, CardContent, Input, Label } from "@/shared/ui";
import content from "@content/margins.ar.json";

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
const errText = (s: MarginActionResult | null) => (s && !s.ok ? (content.errors as Record<string, string>)[s.error] ?? content.errors.invalid_input : null);

export type MarginPanelProps = {
  subjectType: "mission" | "planner_task"; subjectId: string;
  minutes: number; extraMin: number; label: string | null; why: string | null; whyLabel: string;
  /** ب.6 منع التأثر: مخفي حتى يكتب المستخدم تقديره (L2 فما فوق للتخطيط) */
  hidden: boolean;
  /** suggest_only: توصية تُعرض بلمسة ولا تُملأ */
  suggestion: number | null;
  /** teen/adult: صاحب المهمة يعدّل هامشه */
  canEdit: boolean;
  startedAt: string | null; running: boolean;
  step: number; min: number; max: number; extensionOptions: number[];
};

/** P07/P08: «عندك X دقيقة» + «حدّده لك …» + «ليش؟»، وعند انتهاء الهامش «تحتاج وقتًا أكثر؟» بلا أي عقوبة. */
export function MarginPanel(p: MarginPanelProps) {
  const [setState, setAction, setPending] = useActionState(setTaskMarginAction, null);
  const [extState, extAction, extPending] = useActionState(extendMarginAction, null);
  const total = p.minutes + p.extraMin;
  const endsAt = p.startedAt ? Date.parse(p.startedAt) + total * 60000 : null;
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!p.running || !endsAt) { setOver(false); return; }
    const tick = () => setOver(Date.now() >= endsAt);
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [p.running, endsAt]);
  if (p.hidden) return <Card><CardContent className="p-4 text-sm text-muted-foreground">{content.hidden_until_estimate}</CardContent></Card>;
  const hiddenFields = <><input type="hidden" name="subject_type" value={p.subjectType} /><input type="hidden" name="subject_id" value={p.subjectId} /></>;
  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{fill(content.you_have, { min: total })}</span>
          {p.label && <span className="text-muted-foreground">· {p.label}</span>}
          {p.why && <details className="ms-auto"><summary className="cursor-pointer text-muted-foreground">{p.whyLabel}</summary><p className="mt-1 text-muted-foreground">{p.why}</p></details>}
        </div>
        {p.canEdit && p.suggestion !== null && (
          <form action={setAction} className="flex flex-wrap items-center gap-2">
            {hiddenFields}<input type="hidden" name="minutes" value={p.suggestion} />
            <span className="text-muted-foreground">{fill(content.suggest_from_history, { min: p.suggestion })}</span>
            <Button type="submit" size="sm" variant="outline" disabled={setPending}>{content.ui.accept}</Button>
          </form>
        )}
        {p.canEdit && !p.running && (
          <form action={setAction} className="flex flex-wrap items-end gap-2">
            {hiddenFields}
            <div className="space-y-1"><Label htmlFor={`m-${p.subjectId}`}>{content.ui.title}</Label><Input id={`m-${p.subjectId}`} name="minutes" type="number" dir="ltr" min={p.min} max={p.max} step={p.step} defaultValue={p.minutes} className="w-24" /></div>
            <select name="apply_scope" defaultValue="this_task" className="h-10 rounded-xl border bg-background px-2" aria-label={content.ui.title}>
              <option value="this_task">{content.apply_scopes.this_task}</option><option value="all_similar">{content.apply_scopes.all_similar}</option>
            </select>
            <Button type="submit" size="sm" disabled={setPending}>{content.ui.save}</Button>
          </form>
        )}
        {errText(setState) && <p className="text-destructive">{errText(setState)}</p>}
        {over && (
          <form action={extAction} className="flex flex-wrap items-center gap-2" aria-live="polite">
            {hiddenFields}
            <span>{content.overtime}</span>
            {p.extensionOptions.map((m) => <Button key={m} type="submit" name="minutes" value={m} size="sm" variant="outline" disabled={extPending}>+{m}</Button>)}
          </form>
        )}
        {errText(extState) && <p className="text-destructive">{errText(extState)}</p>}
      </CardContent>
    </Card>
  );
}
