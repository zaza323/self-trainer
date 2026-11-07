"use client";
import paceContent from "@content/pace.ar.json";
import Link from "next/link";
import { useActionState, useState } from "react";
import { answerMomentAction, dismissMomentAction } from "../actions";
import type { StartData } from "../start-data";
import { FollowupSheet } from "@/modules/followups/components/followup-sheet";
import { NextCard } from "@/modules/followups/components/next-card";
import { DndButton, ReturnFlow } from "@/modules/engagement/components/engagement-widgets";
import { maxSheetsPerOpen, lightShortcutsMax } from "../openers";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import openers from "@content/daily_openers.ar.json";
import followupsContent from "@content/followups.ar.json";
import restContent from "@content/rest_activities.ar.json";
import { t } from "@/shared/i18n";

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const timeOf = (d: Date | string, tz: string) => new Intl.DateTimeFormat("ar", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(d));

/** P36/P37: إجابة اللحظة — أولويات 1–3 من مهام اليوم أو بكلمات المستخدم (L2+: كتابة أولًا)، تأكيد، أو تأمل مسائي. */
function MomentAnswer({ data }: { data: StartData }) {
  const { facts, supportBand } = data;
  const d = facts.decision;
  const [s, act, pending] = useActionState(answerMomentAction, null);
  const [, dismiss] = useActionState(dismissMomentAction, null);
  const [free, setFree] = useState(supportBand === "L2_L3");
  if (d.kind !== "moment") return null;
  const a = openers.answer;
  if (s?.ok) return <Alert variant="success">{d.moment === "night_plan" ? a.saved_night : a.saved}</Alert>;
  const Skip = () => <div className="flex gap-2"><Button size="sm" variant="ghost" asChild><Link href="/app/planner?view=today">{openers.skip.go_planner}</Link></Button><form action={dismiss}><input type="hidden" name="moment" value={d.moment} /><Button size="sm" variant="ghost" type="submit">{openers.skip.not_now}</Button></form></div>;
  if (d.moment === "muhasaba") return <div className="space-y-2"><Button size="sm" asChild><Link href="/app/muhasaba">{openers.moment_names.muhasaba}</Link></Button><Skip /></div>;
  if (d.confirm) return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="moment" value={d.moment} />
      <div className="flex gap-2"><Button size="sm" type="submit" name="confirm" value="yes" disabled={pending}>{a.confirm_yes}</Button><Button size="sm" variant="outline" type="submit" name="confirm" value="change">{a.confirm_change}</Button></div>
    </form>
  );
  if (d.moment === "evening_review") return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="moment" value={d.moment} />
      <div><Label htmlFor="ev">{a.free_label}</Label><textarea id="ev" name="free" rows={2} maxLength={1500} className="w-full rounded-xl border border-input bg-background p-3" required /></div>
      {facts.overdueCount > 0 && <p className="text-xs text-muted-foreground">{a.evening_q2} <Link className="underline" href="/app/planner/overdue">{facts.overdueCount}</Link></p>}
      <div className="flex gap-2"><Button size="sm" type="submit" disabled={pending}>{a.save}</Button></div><Skip />
    </form>
  );
  // morning_plan / night_plan / midday_check ⇒ priority_pick (ج.7: L2+ كتابة أولًا، الخيارات بعد stuck أو بالطلب)
  return (
    <form action={act} className="space-y-2" data-testid={`moment-${supportBand}`}>
      <input type="hidden" name="moment" value={d.moment} />
      {!free && facts.topToday.length > 0 && <div className="space-y-1"><Label>{a.pick_label}</Label>{facts.paceBased && <p className="text-xs text-muted-foreground">{paceContent.morning_hint.replace("{n}", String(facts.suggestedPriorities))}</p>}{facts.topToday.map((tk) => <label key={tk.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="task_ids" value={tk.id} /> {tk.title}</label>)}</div>}
      {(free || facts.topToday.length === 0) && <div><Label htmlFor="pt">{a.free_label}</Label><Input id="pt" name="texts" maxLength={200} required /></div>}
      {free && facts.topToday.length > 0 && <Button size="sm" variant="ghost" type="button" onClick={() => setFree(false)}>{a.pick_label}</Button>}
      <div className="flex gap-2"><Button size="sm" type="submit" disabled={pending}>{a.save}</Button></div><Skip />
    </form>
  );
}

/** P35 شاشة المرافق كبداية: ترتيب ج.4 — المتابعة ثم التالي (ورقتان كحد أقصى) ثم الافتتاحية؛ بطاقات سريعة؛ تخطٍّ دائم. */
export function StartScreen({ data, tz }: { data: StartData; tz: string }) {
  const { facts, followups, next, soon, training, dndActive, returnFlow } = data;
  const [sheetsUsed, setSheetsUsed] = useState(0);
  const d = facts.decision;
  const pendingItems = followups.items.filter((f) => f.status === "pending" || f.status === "snoozed");
  const showFollowups = pendingItems.length > 0 && sheetsUsed === 0;
  const sheetsAfterFollowup = showFollowups ? 1 : 0;
  const showNext = !facts.quietNow && (sheetsAfterFollowup + 1 <= maxSheetsPerOpen);
  const showOpener = !showFollowups && (sheetsUsed + (showNext ? 1 : 0)) < maxSheetsPerOpen;
  const gapMin = next.card.kind === "free_gap" && next.card.untilAt ? Math.round((next.card.untilAt.getTime() - Date.now()) / 60000) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("nav.start")}</h2><DndButton active={dndActive} /></div>
      {returnFlow && <ReturnFlow absenceHours={returnFlow.absenceHours} scheduledCount={returnFlow.scheduledCount} doneCount={returnFlow.doneCount} />}
      {d.kind === "safety" && <Alert variant="warning"><Link href="/app/chat" className="underline">{t("nav.chat")}</Link></Alert>}
      {d.kind === "comeback" && <Card><CardHeader><CardTitle className="text-base">{t("home.comeback_title")}</CardTitle></CardHeader><CardContent><Button size="sm" variant="outline" asChild><Link href="/app/chat?mode=comeback">{t("nav.chat")}</Link></Button></CardContent></Card>}
      {facts.deadlines.length > 0 && <div className="flex flex-wrap gap-2">{facts.deadlines.map((c) => <Badge key={c.task.id} variant="warning">{openers.cards.deadline_soon}: {c.task.title}</Badge>)}</div>}
      {soon && <Alert className="text-sm">{fill(followupsContent.soon, { min: Math.round((soon.startsAt.getTime() - Date.now()) / 60000), title: soon.title })}</Alert>}
      {showFollowups && <FollowupSheet items={pendingItems} presentation={followups.presentation === "list" ? "list" : "sheets"} tz={tz} askDurationFeel onDone={() => setSheetsUsed(1)} />}
      {facts.windDownNow && <Card data-testid="wind-down"><CardContent className="space-y-2 p-4"><p className="font-medium">{restContent.wind_down.message}</p><div className="flex gap-2"><Button size="sm" asChild><Link href="/app/rest?source=wind_down">{restContent.title}</Link></Button>{facts.settings.enabled.includes("muhasaba") && !facts.decision.kind.startsWith("moment") && <Button size="sm" variant="outline" asChild><Link href="/app/muhasaba">{openers.moment_names.muhasaba}</Link></Button>}</div></CardContent></Card>}
      {showNext && !facts.windDownNow && <NextCard decision={next} tz={tz} gapMin={gapMin} />}
      {showOpener && (d.kind === "moment" || d.kind === "deadline" || d.kind === "light" || d.kind === "no_tasks") && (
        <Card className="border-primary/40" data-testid={`opener-${d.kind}`}>
          <CardHeader><CardTitle className="text-base">{facts.openerText}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {d.kind === "moment" && <MomentAnswer data={data} />}
            {d.kind === "deadline" && <div className="flex flex-wrap gap-2"><Button size="sm" asChild><Link href={`/app/planner?view=today`}>{openers.deadline_options.start_now}</Link></Button><Button size="sm" variant="outline" asChild><Link href="/app/planner/calendar">{openers.deadline_options.block}</Link></Button><Button size="sm" variant="ghost" asChild><Link href="/app/planner/overdue">{openers.deadline_options.postpone}</Link></Button></div>}
            {(d.kind === "light" || d.kind === "no_tasks") && <div className="flex flex-wrap gap-2">{([["/app/planner", openers.shortcuts.add_task], ["/app/planner/focus", openers.shortcuts.start_focus], ["/app/home", openers.shortcuts.training_mission]] as Array<[string, string]>).slice(0, lightShortcutsMax).map(([href, label]) => <Button key={href} size="sm" variant="outline" asChild><Link href={href}>{label}</Link></Button>)}</div>}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <Card><CardContent className="p-3 text-sm"><div className="text-xs text-muted-foreground">{openers.cards.next_deadline}</div>{facts.deadlines[0] ? `${facts.deadlines[0].task.title} · ${facts.deadlines[0].task.due_time?.slice(0, 5) ?? facts.deadlines[0].task.due_date}` : openers.cards.none}</CardContent></Card>
        <Card><CardContent className="p-3 text-sm"><div className="text-xs text-muted-foreground">{openers.cards.top_today}</div>{facts.priorities.length ? facts.priorities.map((p) => p.text).join("، ") : facts.topToday.map((x) => x.title).join("، ") || openers.cards.none}</CardContent></Card>
        <Card><CardContent className="p-3 text-sm"><div className="text-xs text-muted-foreground">{openers.cards.training}</div>{training ? <Link className="underline" href={`/app/missions/${training.id}`}>{training.title}</Link> : openers.cards.none}</CardContent></Card>
      </div>
      {next.card.kind === "next" && <span className="hidden" data-testid="next-time">{timeOf(next.card.item.startsAt, tz)}</span>}
    </div>
  );
}
