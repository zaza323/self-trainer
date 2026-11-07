"use client";
/** المرحلة 11: «قسّمها» (task_breakdown بالتدرج)، «رتّب يومي» (day_planner)، و«تدرّب على هذه المهمة الحقيقية». كل اقتراح معاينة. */
import { startTransition, useActionState, useState } from "react";
import { breakdownAction, saveBreakdownAction, dayPlanAction, applyDayPlanAction, convertToMissionAction, type Res } from "../actions-phase11";
import type { BreakdownResult, DayPlanResult } from "../ai";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/shared/ui";
import { plannerContent as c } from "../labels";

const t = c.ai;
const Err = ({ s }: { s: Res | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{(c.refusals as Record<string, string>)[s.error] ?? t.breakdown.unavailable}</Alert> : null);
type Step = { title: string; source: "user" | "ai"; estimate_min?: number | null };

/** P25 «قسّمها»: L0–L1 مسودة قابلة للتعديل؛ L2–L3 «شو أول خطوة؟» أولًا، ثم حتى خطوتين ناقصتين كخيارات. */
export function BreakdownPanel({ taskId, lowSupport }: { taskId: string; lowSupport: boolean }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [mine, setMine] = useState("");
  const [result, setResult] = useState<BreakdownResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveState, saveAct, saving] = useActionState(saveBreakdownAction, null);
  const ask = () => {
    const fd = new FormData(); fd.set("task_id", taskId);
    for (const s of steps.filter((x) => x.source === "user")) fd.append("user_step", s.title);
    setBusy(true);
    startTransition(async () => { const r = await breakdownAction(null, fd); setBusy(false); if (r.ok) setResult(r.data as BreakdownResult); });
  };
  const addMine = () => { if (mine.trim()) { setSteps((s) => [...s, { title: mine.trim(), source: "user" }]); setMine(""); } };
  const takeSuggested = (st: { title: string; estimate_min: number | null }) => { setSteps((s) => [...s, { title: st.title, source: "ai", estimate_min: st.estimate_min }]); setResult((r) => (r ? { ...r, steps: r.steps.filter((x) => x.title !== st.title) } : r)); };
  const firstStepNeeded = !lowSupport && steps.filter((s) => s.source === "user").length === 0;
  return (
    <Card data-testid="breakdown-panel">
      <CardHeader><CardTitle className="text-base">{t.breakdown.title}</CardTitle>{firstStepNeeded && <CardDescription>{t.breakdown.ask_first_hint}</CardDescription>}</CardHeader>
      <CardContent className="space-y-3">
        {firstStepNeeded && <p className="font-medium" data-testid="ask-first">{t.breakdown.ask_first}</p>}
        <ul className="space-y-1">{steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <Input value={s.title} maxLength={120} aria-label={t.breakdown.your_step} onChange={(e) => setSteps((all) => all.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setSteps((all) => all.filter((_, k) => k !== i))}>✕</Button>
          </li>))}
        </ul>
        <div className="flex gap-2"><Input value={mine} onChange={(e) => setMine(e.target.value)} placeholder={t.breakdown.your_step} maxLength={120} aria-label={t.breakdown.your_step} /><Button type="button" variant="outline" onClick={addMine} disabled={!mine.trim()}>{t.breakdown.add_step}</Button></div>
        {!firstStepNeeded && <Button type="button" variant="secondary" onClick={ask} disabled={busy}>{lowSupport ? t.breakdown.propose : t.breakdown.suggest}</Button>}
        {result && result.steps.length > 0 && (
          <div className="space-y-1">
            <strong className="text-sm">{result.kind === "draft" ? t.breakdown.draft_title : t.breakdown.suggested_title}</strong>
            <ul className="space-y-1">{result.steps.map((s) => <li key={s.title} className="flex items-center gap-2 text-sm"><span>{s.title}</span><Button type="button" size="sm" variant="outline" onClick={() => takeSuggested(s)}>{t.breakdown.use}</Button></li>)}</ul>
          </div>
        )}
        {result && result.steps.length === 0 && result.kind !== "ask_first" && <p className="text-sm text-muted-foreground">{t.breakdown.unavailable}</p>}
        {steps.length > 0 && (
          <form action={saveAct}><input type="hidden" name="task_id" value={taskId} /><input type="hidden" name="steps" value={JSON.stringify(steps.filter((s) => s.title.trim()))} /><Button type="submit" disabled={saving}>{t.breakdown.save}</Button></form>
        )}
        {saveState?.ok && <Alert variant="success" className="text-sm">{t.breakdown.saved}</Alert>}
        <Err s={saveState} />
      </CardContent>
    </Card>
  );
}

/** «رتّب يومي»: L0–L1 ترتيب كامل؛ L2–L3 يختار المستخدم 1–3 أولًا. الاعتماد بفعل منفصل. */
export function DayPlanPanel({ tasks, pickMode }: { tasks: Array<{ id: string; title: string }>; pickMode: boolean }) {
  const [picks, setPicks] = useState<string[]>([]);
  const [plan, setPlan] = useState<DayPlanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyState, applyAct, applying] = useActionState(applyDayPlanAction, null);
  if (!tasks.length) return null;
  const title = (id: string) => tasks.find((x) => x.id === id)?.title ?? "";
  const propose = () => {
    const fd = new FormData(); for (const p of picks) fd.append("pick", p);
    setBusy(true);
    startTransition(async () => { const r = await dayPlanAction(null, fd); setBusy(false); if (r.ok) setPlan(r.data as DayPlanResult); });
  };
  const pickOk = !pickMode || (picks.length >= 1 && picks.length <= 3);
  return (
    <Card data-testid="day-plan-panel">
      <CardHeader><CardTitle className="text-base">{t.day_planner.title}</CardTitle>{pickMode && <CardDescription>{t.day_planner.pick_hint}</CardDescription>}</CardHeader>
      <CardContent className="space-y-3">
        {pickMode && (
          <fieldset className="space-y-1"><legend className="text-sm font-medium">{t.day_planner.pick_title}</legend>
            {tasks.map((x) => <label key={x.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picks.includes(x.id)} onChange={(e) => setPicks((p) => (e.target.checked ? [...p, x.id] : p.filter((y) => y !== x.id)))} /> {x.title}</label>)}
            {picks.length > 3 && <p className="text-xs text-muted-foreground">{t.day_planner.too_many}</p>}
          </fieldset>
        )}
        <Button type="button" variant="secondary" onClick={propose} disabled={busy || !pickOk}>{pickMode ? t.day_planner.place : t.day_planner.propose}</Button>
        {plan?.ok && (
          <>
            <ol className="space-y-1 text-sm">{plan.placements.map((p) => <li key={p.task_id} className="flex gap-2"><Badge variant="secondary" dir="ltr">{p.start}–{p.end}</Badge><span>{title(p.task_id)}</span></li>)}</ol>
            <form action={applyAct}><input type="hidden" name="placements" value={JSON.stringify(plan.placements)} /><Button type="submit" disabled={applying || !plan.placements.length}>{t.day_planner.apply}</Button></form>
          </>
        )}
        {applyState?.ok && <Alert variant="success" className="text-sm">{t.day_planner.applied}</Alert>}
        <Err s={applyState} />
      </CardContent>
    </Card>
  );
}

/** ب.11: تحويل مهمة حقيقية إلى تدريب مرتبط. */
export function ConvertToMission({ taskId, linked }: { taskId: string; linked: boolean }) {
  const [s, act, pending] = useActionState(convertToMissionAction, null);
  if (linked) return <Badge variant="secondary">{t.convert.linked}</Badge>;
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="task_id" value={taskId} />
      <Button type="submit" variant="outline" disabled={pending || Boolean(s?.ok)}>{t.convert.button}</Button>
      {s?.ok && <Alert variant="success" className="text-sm">{t.convert.done}</Alert>}
      <Err s={s} />
    </form>
  );
}
