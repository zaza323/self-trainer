"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { chooseMission, dismissSuggestion, planMission, startMission, interruptMission, resumeMission, logDistraction, useHint, toggleChecklistItem, completeMission, abandonMission, submitReflection } from "../actions";
import type { MissionRow, ReflectionRow } from "../types";
import type { MissionTemplate } from "@/modules/library";
import { textByMode } from "@/modules/library/schema";
import { scenarioText } from "@/modules/library/scenario";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";
import type { AgeMode } from "@/shared/config";
import { Timer } from "./timer";
import contextTags from "@content/context_tags.ar.json";
import { Celebration } from "@/modules/game/components/celebration";
import { useMissionOffline } from "@/shared/offline/use-mission-offline";
import { scheduleTimerNotification, cancelTimerNotification } from "@/shared/offline/timer-notification";
import type { OpKind } from "@/shared/offline/db";
import type { MissionStatus } from "../state-machine";
import offlineContent from "@content/offline.ar.json";
import notificationsContent from "@content/notifications.ar.json";
import adaptationContent from "@content/adaptation.ar.json";

type Props = {
  mission: MissionRow;
  template: MissionTemplate;
  mode: AgeMode;
  reflection: ReflectionRow | null;
  reflectionPrompts: string[];
  interruptionQuestion: string;
  narrative: string[];
  alternatives: Array<{ text: string; hint: string }>;
  distraction: { firstAtFraction: number; spreadFraction: number };
  goalOptions: Array<{ id: string; title: string }>;
  chain: React.ReactNode;
  celebration?: { level: "none" | "subtle" | "full"; messages: string[] };
  reflectionOverride?: React.ReactNode;
  after?: React.ReactNode;
  /** أسئلة التأمل عند التخلي (للمسار دون اتصال حين تُسقط الحالة محليًا) */
  reflectionPromptsAbandon?: string[];
  /** ADAPT-3: معرّف الاستراتيجية الأنجح سابقًا (L0–L1) لوسم "نجحت معك سابقًا" */
  workedBefore?: string | null;
};
/** دون اتصال: الإرسال يذهب إلى الطابور بدل إجراء الخادم. */
type Offline = { online: boolean; submit: (kind: OpKind, payload?: Record<string, unknown>) => Promise<void> };
function guard(offline: Offline, kind: OpKind, payload: (f: HTMLFormElement) => Record<string, unknown> = () => ({})) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    if (offline.online && navigator.onLine) return;
    e.preventDefault();
    void offline.submit(kind, payload(e.currentTarget));
  };
}

type R = { ok: true; data?: unknown } | { ok: false; error: string } | null;
const Err = ({ s }: { s: R }) => (s && !s.ok ? <p className="text-sm text-destructive">{t(`missions.${s.error}`) !== `missions.${s.error}` ? t(`missions.${s.error}`) : `${t("common.error_generic")} (${s.error})`}</p> : null);

function Situation({ mission, template, mode }: { mission: MissionRow; template: MissionTemplate; mode: AgeMode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{textByMode(template.title, mode)}</CardTitle>
          <div className="flex gap-1"><Badge variant="secondary">{t(`missions.level.${template.training_level}`)}</Badge><Badge variant="outline">{t("missions.difficulty")} {mission.difficulty}</Badge><Badge variant="muted">{t(`missions.status.${mission.status}`)}</Badge></div>
        </div>
        <CardDescription className="text-base leading-relaxed text-foreground">{scenarioText(template, mode, mission.variables)}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function Choose({ mission, goalOptions }: { mission: MissionRow; goalOptions: Props["goalOptions"] }) {
  const [s, act, pending] = useActionState(chooseMission, null);
  const [d, dismiss, dismissing] = useActionState(dismissSuggestion, null);
  if (mission.needs_approval) return <Card><CardContent className="p-4 text-sm">{t("missions.awaiting_approval")}</CardContent></Card>;
  return (
    <Card><CardContent className="space-y-3 p-4">
      <form action={act} className="space-y-2">
        <input type="hidden" name="mission_id" value={mission.id} />
        {goalOptions.length > 0 && (
          <div className="space-y-1"><Label htmlFor="goal">{t("missions.serves_goal")}</Label>
            <select id="goal" name="goal_id" defaultValue={mission.goal_id ?? goalOptions[0]!.id} className="flex min-h-11 w-full rounded-xl border border-input bg-background px-3">{goalOptions.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></div>
        )}
        <div className="flex gap-2"><Button type="submit" disabled={pending}>{t("missions.choose")}</Button></div>
        <Err s={s} />
      </form>
      <form action={dismiss}><input type="hidden" name="mission_id" value={mission.id} /><Button type="submit" variant="ghost" size="sm" disabled={dismissing}>{t("missions.swap")}</Button><Err s={d} /></form>
    </CardContent></Card>
  );
}

function Plan({ mission, template, mode, workedBefore }: { mission: MissionRow; template: MissionTemplate; mode: AgeMode; workedBefore?: string | null }) {
  const [s, act, pending] = useActionState(planMission, null);
  const [custom, setCustom] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("missions.plan_title")}</CardTitle></CardHeader>
      <CardContent>
        <form action={act} className="space-y-4">
          <input type="hidden" name="mission_id" value={mission.id} />
          <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("missions.strategy")}</legend>
            {template.strategies.map((st) => (
              <label key={st.id} className="flex items-start gap-2 rounded-xl border p-3"><input type="radio" name="strategy_id" value={st.id} className="mt-1" disabled={Boolean(custom)} /> <span>{textByMode(st.text, mode)}{workedBefore === st.id && <Badge variant="success" className="ms-2">{adaptationContent.strategy_memory.worked_before}</Badge>}</span></label>
            ))}
            <div className="space-y-1"><Label htmlFor="custom">{t("missions.custom_strategy")}</Label><Input id="custom" name="custom_strategy" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={300} /></div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="time_estimate">{t("missions.time_estimate")}</Label><Input id="time_estimate" name="time_estimate" type="number" min={1} max={600} dir="ltr" required defaultValue={template.min_duration} /></div>
            {template.prediction_prompt && <div className="space-y-1"><Label htmlFor="prediction">{textByMode(template.prediction_prompt, mode)}</Label><Input id="prediction" name="prediction" type="number" min={0} step="1" dir="ltr" required /></div>}
            {template.training_level !== "simulated" && (
              <div className="space-y-1"><Label htmlFor="context_tag">{t("missions.context_tag")}</Label>
                <select id="context_tag" name="context_tag" defaultValue="home" className="flex min-h-11 w-full rounded-xl border border-input bg-background px-3">
                  {Object.entries(contextTags).filter(([k]) => !k.startsWith("_") && k !== "in_app").map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
                </select></div>
            )}
          </div>
          <Err s={s} />
          <Button type="submit" disabled={pending}>{t("missions.plan_submit")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Hints({ mission, template }: { mission: MissionRow; template: MissionTemplate }) {
  const [s, act, pending] = useActionState(useHint, null);
  const available = (template.hints_by_level[mission.support_level] ?? []).length > 0;
  if (!available) return null;
  return (
    <form action={act} className="space-y-1">
      <input type="hidden" name="mission_id" value={mission.id} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>{t("missions.hint")} ({mission.hints_used})</Button>
      {s?.ok && typeof s.data === "string" && <Alert>{s.data}</Alert>}
      <Err s={s} />
    </form>
  );
}

function Distractor({ mission, template, onLogged }: { mission: MissionRow; template: MissionTemplate; onLogged: () => void }) {
  const [s, act, pending] = useActionState(logDistraction, null);
  useEffect(() => { if (s?.ok) onLogged(); }, [s, onLogged]);
  const forced = template.distraction_config?.kind === "forced_pause";
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md border-amber-300">
        <CardHeader><CardTitle>{forced ? "توقف قليلًا" : t("missions.distractor_title")}</CardTitle><CardDescription>{forced ? "سنوقفك الآن عن قصد. خذ نفسًا، وعندما تكون جاهزًا عُد." : template.distraction_config?.kind === "open_now_button" ? "زر (افتح الآن) يغريك. ماذا ستفعل؟" : "لعبة جانبية تدعوك للعب الآن. ماذا ستفعل؟"}</CardDescription></CardHeader>
        <CardContent>
          <form action={act} className="grid gap-2">
            <input type="hidden" name="mission_id" value={mission.id} />
            {forced ? (
              <Button type="submit" name="choice" value="break_return" disabled={pending}>عدتُ وأكمل</Button>
            ) : (
              <>
                <Button type="submit" name="choice" value="ignore" disabled={pending}>{t("missions.distractor_ignore")}</Button>
                <Button type="submit" name="choice" value="break_return" variant="secondary" disabled={pending}>{t("missions.distractor_break")}</Button>
                <Button type="submit" name="choice" value="give_in" variant="outline" disabled={pending}>{t("missions.distractor_give_in")}</Button>
              </>
            )}
            <p className="text-xs text-muted-foreground">{t("missions.distractor_logged")}</p>
            <Err s={s} />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Execute({ mission, template, distraction, offline, mode }: { mission: MissionRow; template: MissionTemplate; distraction: Props["distraction"]; offline: Offline; mode: AgeMode }) {
  const router = useRouter();
  const [stop, stopAct, stopping] = useActionState(interruptMission, null);
  const [done, doneAct, completing] = useActionState(completeMission, null);
  const [ab, abAct, abandoning] = useActionState(abandonMission, null);
  const [, toggleAct] = useActionState(toggleChecklistItem, null);
  const [timerDone, setTimerDone] = useState(false);
  const [showDistractor, setShowDistractor] = useState(false);

  // جدولة المشتت المحاكى (MIS-5) على كسور من المدة الدنيا (القيم من config/limits.json)
  const schedule = useMemo(() => {
    const cfg = template.distraction_config;
    if (!cfg || !mission.started_at) return [] as number[];
    const totalMs = template.min_duration * 60000;
    return Array.from({ length: cfg.count }, (_, i) => Date.parse(mission.started_at!) + totalMs * (distraction.firstAtFraction + (cfg.count > 1 ? (i * distraction.spreadFraction) / (cfg.count - 1) : 0)));
  }, [template, mission.started_at, distraction]);
  useEffect(() => {
    if (schedule.length === 0) return;
    const check = () => {
      const due = schedule.filter((ts) => Date.now() >= ts).length;
      if (due > mission.distraction_log.length) setShowDistractor(true);
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [schedule, mission.distraction_log.length]);

  const isTimer = template.completion_check === "timer";
  // MIS-4: إشعار محلي عند انتهاء المؤقت عبر الـService Worker
  useEffect(() => {
    if (!mission.started_at) return;
    const minutes = isTimer ? template.min_duration : mission.time_estimate ?? template.min_duration;
    const tag = `timer:${mission.id}`;
    const txt = notificationsContent.types.timer_done[mode];
    void scheduleTimerNotification({ at: Date.parse(mission.started_at) + minutes * 60000, title: txt.title, body: txt.body, url: `/app/missions/${mission.id}`, tag });
    return () => { void cancelTimerNotification(tag); };
  }, [mission.started_at, mission.id, mission.time_estimate, template.min_duration, isTimer, mode]);
  const checklist = template.checklist ?? [];
  const doneSet = new Set(mission.checklist_done);
  return (
    <div className="space-y-3">
      {showDistractor && <Distractor mission={mission} template={template} onLogged={() => { setShowDistractor(false); router.refresh(); }} />}
      <Card>
        <CardHeader><CardTitle className="text-base">{t("missions.in_progress")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {mission.started_at && <Timer startedAt={mission.started_at} minutes={isTimer ? template.min_duration : mission.time_estimate ?? template.min_duration} onDone={() => setTimerDone(true)} label={t("missions.timer")} />}
          {timerDone && isTimer && <Alert variant="success">{t("missions.timer_done")}</Alert>}
          {checklist.length > 0 && (
            <div className="space-y-1">
              <div className="text-sm font-medium">{t("missions.checklist")}</div>
              {checklist.map((item, i) => (
                <form key={i} action={toggleAct}>
                  <input type="hidden" name="mission_id" value={mission.id} /><input type="hidden" name="index" value={i} />
                  <button type="submit" className={`flex w-full items-center gap-2 rounded-lg border p-2 text-start ${doneSet.has(i) ? "bg-secondary" : ""}`} aria-pressed={doneSet.has(i)}><span aria-hidden>{doneSet.has(i) ? "☑" : "☐"}</span> {item}</button>
                </form>
              ))}
            </div>
          )}
          <Hints mission={mission} template={template} />
          <div className="flex flex-wrap gap-2">
            <form action={doneAct} onSubmit={guard(offline, "complete")} className="contents"><input type="hidden" name="mission_id" value={mission.id} />{template.completion_check === "self_report" && <input type="hidden" name="actual_duration_min" value="" />}<Button type="submit" disabled={completing}>{t("missions.complete")}</Button></form>
            <form action={stopAct} onSubmit={guard(offline, "interrupt")} className="contents"><input type="hidden" name="mission_id" value={mission.id} /><Button type="submit" variant="outline" disabled={stopping}>{t("missions.stop")}</Button></form>
            <form action={abAct} onSubmit={guard(offline, "abandon")} className="contents"><input type="hidden" name="mission_id" value={mission.id} /><Button type="submit" variant="ghost" disabled={abandoning}>{t("missions.abandon")}</Button></form>
          </div>
          <Err s={done} /><Err s={stop} /><Err s={ab} />
        </CardContent>
      </Card>
    </div>
  );
}

function Interrupted({ mission, question, offline }: { mission: MissionRow; question: string; offline: Offline }) {
  const [s, act, pending] = useActionState(resumeMission, null);
  const [ab, abAct, abandoning] = useActionState(abandonMission, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("missions.interrupted")}</CardTitle><CardDescription>{question}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <form action={act} onSubmit={guard(offline, "resume", (f) => ({ reason: String(new FormData(f).get("reason") ?? "") }))} className="space-y-2">
          <input type="hidden" name="mission_id" value={mission.id} />
          <Input name="reason" maxLength={300} placeholder={question} />
          <div className="flex gap-2"><Button type="submit" disabled={pending}>{t("missions.resume")}</Button></div>
          <Err s={s} />
        </form>
        <form action={abAct} onSubmit={guard(offline, "abandon")}><input type="hidden" name="mission_id" value={mission.id} /><Button type="submit" variant="ghost" size="sm" disabled={abandoning}>{t("missions.abandon")}</Button><Err s={ab} /></form>
      </CardContent>
    </Card>
  );
}

function Reflect({ mission, prompts, offline }: { mission: MissionRow; prompts: string[]; offline: Offline }) {
  const [s, act, pending] = useActionState(submitReflection, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("missions.reflect_title")}</CardTitle><CardDescription>{mission.gate1 ? t("missions.gate1_pass") : t("missions.gate1_fail")}. {t("missions.reflect_title")} جزء من المهمة.</CardDescription></CardHeader>
      <CardContent>
        <form action={act} onSubmit={guard(offline, "reflect", (f) => { const fd = new FormData(f); return { prompts: fd.getAll("prompt").map(String), answers: fd.getAll("answer").map(String) }; })} className="space-y-3">
          <input type="hidden" name="mission_id" value={mission.id} />
          {prompts.map((p, i) => (
            <div key={i} className="space-y-1"><Label htmlFor={`a-${i}`}>{p}</Label><input type="hidden" name="prompt" value={p} /><textarea id={`a-${i}`} name="answer" required rows={2} className="w-full rounded-xl border border-input bg-background p-3" /></div>
          ))}
          <Err s={s} />
          <Button type="submit" disabled={pending}>{t("missions.reflect_submit")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Progress({ mission, narrative, alternatives, reflection }: { mission: MissionRow; narrative: string[]; alternatives: Props["alternatives"]; reflection: ReflectionRow | null }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("missions.progress_title")}</CardTitle>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant={mission.gate1 ? "success" : "warning"}>{mission.gate1 ? t("missions.gate1_pass") : t("missions.gate1_fail")}</Badge>
            {mission.gate2 && <Badge variant={mission.gate2 === "shown" ? "success" : mission.gate2 === "partial" ? "secondary" : "muted"}>{t("missions.gate2_title")}: {t(`missions.gate2.${mission.gate2}`)}</Badge>}
          </div>
          {mission.gate1 && mission.gate2 && mission.gate2 !== "shown" && <CardDescription>{t("missions.gate3_hint")}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-2 text-base leading-relaxed">{narrative.map((l, i) => <p key={i}>{l}</p>)}</CardContent>
      </Card>
      {alternatives.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">{t("missions.alternatives")}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">{alternatives.map((a, i) => <div key={i} className="rounded-lg border p-2"><div className="font-medium">{a.text}</div><div className="text-muted-foreground">{a.hint}</div></div>)}</CardContent></Card>
      )}
      {reflection && (
        <Card><CardHeader><CardTitle className="text-base">{t("missions.reflect_title")}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">{reflection.prompts_and_answers.map((qa, i) => <div key={i}><div className="text-muted-foreground">{qa.prompt}</div><div>{qa.answer}</div></div>)}</CardContent></Card>
      )}
    </div>
  );
}

function Start({ mission }: { mission: MissionRow }) {
  const [s, act, pending] = useActionState(startMission, null);
  return <form action={act}><input type="hidden" name="mission_id" value={mission.id} /><Button type="submit" size="lg" disabled={pending}>{t("missions.start")}</Button><Err s={s} /></form>;
}

export function MissionFlow(p: Props) {
  const { template, mode } = p;
  const off = useMissionOffline(p.mission.id, p.mission.status);
  const projected = off.ops.length > 0;
  const mission: MissionRow = projected ? { ...p.mission, status: off.status as MissionStatus, gate1: off.status === "completed" ? true : off.status === "abandoned" ? false : p.mission.gate1 } : p.mission;
  const offline: Offline = { online: off.online, submit: off.submitOffline };
  const prompts = projected && mission.status === "abandoned" ? p.reflectionPromptsAbandon ?? p.reflectionPrompts : p.reflectionPrompts;
  return (
    <div className="space-y-3">
      {projected && <Alert className="text-sm">{offlineContent.saved_locally}</Alert>}
      <Situation mission={mission} template={template} mode={mode} />
      <div>{p.chain}</div>
      {mission.status === "suggested" && <Choose mission={mission} goalOptions={p.goalOptions} />}
      {mission.status === "chosen" && <Plan mission={mission} template={template} mode={mode} workedBefore={p.workedBefore} />}
      {mission.status === "planned" && <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="text-sm text-muted-foreground">{mission.custom_strategy ?? textByMode(template.strategies.find((s) => s.id === mission.strategy_chosen)?.text, mode)} · {mission.time_estimate} د</div><Hints mission={mission} template={template} /><Start mission={mission} /></CardContent></Card>}
      {mission.status === "in_progress" && <Execute mission={mission} template={template} distraction={p.distraction} offline={offline} mode={mode} />}
      {mission.status === "interrupted" && <Interrupted mission={mission} question={p.interruptionQuestion} offline={offline} />}
      {(mission.status === "completed" || mission.status === "abandoned") && ((off.online && !projected && p.reflectionOverride) || <Reflect mission={mission} prompts={prompts} offline={offline} />)}
      {off.reflectedPending && <Card><CardContent className="p-4 text-sm">{offlineContent.reflection_pending}</CardContent></Card>}
      {!off.reflectedPending && (mission.status === "reflected" || mission.status === "transferred") && p.celebration && <Celebration level={p.celebration.level} messages={p.celebration.messages} />}
      {!off.reflectedPending && (mission.status === "reflected" || mission.status === "transferred") && <Progress mission={mission} narrative={p.narrative} alternatives={p.alternatives} reflection={p.reflection} />}
      {!off.reflectedPending && p.after}
    </div>
  );
}
