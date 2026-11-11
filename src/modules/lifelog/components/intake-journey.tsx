"use client";
/**
 * P52 رحلة التعارف (0.5 أ.3): أدوار ← مسؤوليات (كتابة حرة بلا خيارات) ← التزامات ثابتة (شبكة أسبوعية) ← من يعتمد عليك ← ضغط الوقت ← بطاقة الملخص.
 * التقدم يُحفظ بندًا بندًا، و«ما بدي احكي هلق» في كل خطوة. بلا ذكاء اصطناعي يعمل النموذج الثابت (إضافة يدوية).
 */
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { addLifeItemAction, intakeStepAction, skipIntakeAction, completeIntakeAction, intakeMessageAction, decideLifeSuggestionAction, addCommitmentAction, suggestWindowsAction } from "../actions";
import type { LifeField, LifeLog } from "../rules";
import { AddItem, ItemList, Err } from "./life-items";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import content from "@content/life_log.ar.json";

const S = content.steps;
type Suggestion = { id: string; field: LifeField; text: string };
type RecCtor = new () => { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
const STEPS = ["life_roles", "life_responsibilities", "life_fixed_schedule", "life_dependents", "life_pressure", "summary"] as const;

function Choices({ profileId, field, options, other, chosen }: { profileId: string; field: LifeField; options: string[]; other: string; chosen: string[] }) {
  const [s, act, pending] = useActionState(addLifeItemAction, null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.filter((o) => !chosen.includes(o)).map((o) => (
          <form key={o} action={act}><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value={field} /><input type="hidden" name="text" value={o} />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>{o}</Button></form>
        ))}
      </div>
      <AddItem profileId={profileId} field={field} placeholder={other} />
      <Err s={s} />
    </div>
  );
}

export function IntakeJourney({ profileId, log, step, routine, staleIds, aiAvailable, pending, guardianMode = false, next = "" }: { next?: string; profileId: string; log: LifeLog; step: number; routine: string[]; staleIds: string[]; aiAvailable: boolean; pending: Suggestion[]; guardianMode?: boolean }) {
  const [i, setI] = useState(Math.min(Math.max(step, 0), STEPS.length - 1));
  const [, stepAct] = useActionState(intakeStepAction, null);
  const [, skipAct, skipping] = useActionState(skipIntakeAction, null);
  const [cs, completeAct, completing] = useActionState(completeIntakeAction, null);
  const [ms, msgAct, sending] = useActionState(intakeMessageAction, null);
  const [, decideAct, deciding] = useActionState(decideLifeSuggestionAction, null);
  const [ks, commitAct, committing] = useActionState(addCommitmentAction, null);
  const [ws, windowsAct, suggesting] = useActionState(suggestWindowsAction, null);
  const [text, setText] = useState("");
  const [voiceOk, setVoiceOk] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<InstanceType<RecCtor> | null>(null);
  useEffect(() => { setVoiceOk(typeof window !== "undefined" && Boolean((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition)); }, []);
  const go = (n: number) => { const next = Math.min(Math.max(n, 0), STEPS.length - 1); setI(next); const fd = new FormData(); fd.set("profile_id", profileId); fd.set("step", String(next)); startTransition(() => stepAct(fd)); };
  const voice = () => {
    if (listening) { rec.current?.stop(); return; }
    const Ctor = ((window as unknown as Record<string, RecCtor>).SpeechRecognition ?? (window as unknown as Record<string, RecCtor>).webkitSpeechRecognition)!;
    const r = new Ctor(); r.lang = "ar"; r.interimResults = false;
    r.onresult = (e) => setText(Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ").trim());
    r.onend = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  };
  const key = STEPS[i]!;
  const msg = ms?.ok ? (ms.data as { source: string; followUp: string | null }) : null;
  const texts = (f: LifeField) => log[f].filter((x) => !x.archived).map((x) => x.text);
  return (
    <Card data-testid={`intake-${key}`}>
      <CardHeader>
        <CardTitle className="text-base">{key === "summary" ? S.summary.title : (S as unknown as Record<string, { question: string }>)[key]!.question}</CardTitle>
        <CardDescription>{content.intake.step_of.replace("{i}", String(i + 1)).replace("{n}", String(STEPS.length))}{guardianMode ? ` · ${content.intake.child_note}` : ""}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {key === "life_roles" && <><Choices profileId={profileId} field="roles" options={S.life_roles.options} other={S.life_roles.other} chosen={texts("roles")} /><ItemList profileId={profileId} field="roles" items={log.roles} staleIds={staleIds} /></>}
        {key === "life_responsibilities" && (
          <>
            {aiAvailable ? (
              <form action={msgAct} className="space-y-2" onSubmit={() => setText("")}>
                <input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value="responsibilities" />
                <textarea name="text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder={S.life_responsibilities.placeholder} aria-label={S.life_responsibilities.question} required className="w-full rounded-xl border border-input bg-background p-3" />
                <div className="flex gap-2"><Button type="submit" size="sm" disabled={sending || !text.trim()}>{S.life_responsibilities.send}</Button>{voiceOk && <Button type="button" size="sm" variant="outline" onClick={voice} aria-pressed={listening}>{listening ? S.life_responsibilities.voice_stop : S.life_responsibilities.voice_start}</Button>}</div>
              </form>
            ) : <p className="text-xs text-muted-foreground">{content.intake.rest_note}</p>}
            {msg?.followUp && <Alert variant="info" className="text-sm">{msg.followUp}</Alert>}
            {!msg?.followUp && !aiAvailable && log.responsibilities.length > 0 && log.responsibilities.length <= 1 && <p className="text-sm text-muted-foreground">{content.followups.responsibilities}</p>}
            <Err s={ms} />
            {pending.filter((p) => p.field === "responsibilities").length > 0 && (
              <div className="space-y-2" data-testid="intake-candidates"><strong className="text-sm">{S.life_responsibilities.candidates_title}</strong>
                {pending.filter((p) => p.field === "responsibilities").map((p) => (
                  <form key={p.id} action={decideAct} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-sm"><span>{p.text}</span>
                    <span className="flex gap-1"><input type="hidden" name="suggestion_id" value={p.id} /><Button type="submit" name="decision" value="accepted" size="sm" disabled={deciding}>{S.life_responsibilities.yes}</Button><Button type="submit" name="decision" value="rejected" size="sm" variant="ghost" disabled={deciding}>{S.life_responsibilities.no}</Button></span></form>
                ))}
              </div>
            )}
            <AddItem profileId={profileId} field="responsibilities" placeholder={S.life_responsibilities.placeholder} label={S.life_responsibilities.add} />
            <ItemList profileId={profileId} field="responsibilities" items={log.responsibilities} staleIds={staleIds} />
            {log.responsibilities.at(-1) && <p className="text-xs text-muted-foreground">{content.intake.reflect.replace("{text}", log.responsibilities.at(-1)!.text)}</p>}
          </>
        )}
        {key === "life_fixed_schedule" && (
          <>
            <ul className="space-y-1 text-sm">{routine.map((r) => <li key={r}>{r}</li>)}</ul>
            <form action={commitAct} className="grid gap-2 sm:grid-cols-3">
              <input type="hidden" name="profile_id" value={profileId} />
              <div className="sm:col-span-3"><Label htmlFor="cl">{S.life_fixed_schedule.label}</Label><Input id="cl" name="label" maxLength={40} required /></div>
              <fieldset className="sm:col-span-3 flex flex-wrap gap-2"><legend className="text-sm">{S.life_fixed_schedule.days}</legend>{content.weekdays.map((d, k) => <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" name="days" value={k} /> {d}</label>)}</fieldset>
              <div><Label htmlFor="cf">{S.life_fixed_schedule.from}</Label><Input id="cf" name="from" type="time" dir="ltr" required /></div>
              <div><Label htmlFor="ct">{S.life_fixed_schedule.to}</Label><Input id="ct" name="to" type="time" dir="ltr" required /></div>
              <div className="flex items-end"><Button type="submit" size="sm" variant="outline" disabled={committing}>{S.life_fixed_schedule.add}</Button></div>
            </form>
            <Err s={ks} />
            {routine.length > 0 && <form action={windowsAct}><input type="hidden" name="profile_id" value={profileId} /><Button type="submit" size="sm" variant="ghost" disabled={suggesting}>{S.life_fixed_schedule.suggest_windows}</Button></form>}
            {ws?.ok && <Alert variant="success" className="text-sm">{S.life_fixed_schedule.windows_saved}</Alert>}
            {ws && !ws.ok && <Alert variant="info" className="text-sm">{S.life_fixed_schedule.windows_none}</Alert>}
          </>
        )}
        {key === "life_dependents" && <><p className="text-xs text-muted-foreground">{S.life_dependents.hint}</p><Choices profileId={profileId} field="dependents" options={S.life_dependents.options} other={S.life_dependents.other} chosen={texts("dependents")} /><ItemList profileId={profileId} field="dependents" items={log.dependents} staleIds={staleIds} /></>}
        {key === "life_pressure" && <><Choices profileId={profileId} field="pressures" options={S.life_pressure.options} other={S.life_pressure.free_label} chosen={texts("pressures")} /><ItemList profileId={profileId} field="pressures" items={log.pressures} staleIds={staleIds} /></>}
        {key === "summary" && (
          <div className="space-y-3" data-testid="intake-summary">
            <p className="text-sm text-muted-foreground">{S.summary.hint}</p>
            {(["roles", "responsibilities", "dependents", "pressures"] as LifeField[]).map((f) => <div key={f} className="space-y-1"><strong className="text-sm">{(content.fields as Record<string, string>)[f]}</strong><ItemList profileId={profileId} field={f} items={log[f]} staleIds={staleIds} /></div>)}
            {routine.length > 0 && <div className="space-y-1"><strong className="text-sm">{content.fields.routine}</strong><ul className="text-sm">{routine.map((r) => <li key={r}>{r}</li>)}</ul></div>}
            <form action={completeAct}><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="next" value={next} /><Button type="submit" disabled={completing}>{content.intake.done}</Button></form>
            <Err s={cs} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {i > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => go(i - 1)}>{content.intake.back}</Button>}
          {i < STEPS.length - 1 && <Button type="button" size="sm" onClick={() => go(i + 1)}>{content.intake.next}</Button>}
          <form action={skipAct} className="ms-auto"><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="next" value={next} /><Button type="submit" size="sm" variant="ghost" disabled={skipping}>{content.intake.skip}</Button></form>
        </div>
      </CardContent>
    </Card>
  );
}
