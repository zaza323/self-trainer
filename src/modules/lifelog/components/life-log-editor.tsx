"use client";
/** P53 «سجل حياتي»: عرض وتعديل وحذف، آخر تأكيد لكل عنصر، تجديد «تغيّر شي بحياتك؟»، و«عندك موقف قريب هالأسبوع؟». */
import Link from "next/link";
import { useActionState } from "react";
import { nothingChangedAction, startOwnSituationAction } from "../actions";
import { LIFE_FIELDS, type LifeLog } from "../rules";
import { AddItem, ItemList, Err } from "./life-items";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/shared/ui";
import content from "@content/life_log.ar.json";

export function RefreshPrompt({ profileId }: { profileId: string }) {
  const [s, act, pending] = useActionState(nothingChangedAction, null);
  if (s?.ok) return <Alert variant="success" className="text-sm">{content.refresh.done}</Alert>;
  return (
    <Card data-testid="life-refresh"><CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <span className="font-medium">{content.refresh.question}</span>
      <form action={act}><input type="hidden" name="profile_id" value={profileId} /><Button type="submit" size="sm" disabled={pending}>{content.refresh.nothing}</Button></form>
      <Button asChild size="sm" variant="outline"><Link href="/app/life">{content.refresh.edit}</Link></Button>
      <Err s={s} />
    </CardContent></Card>
  );
}

export function OwnSituation() {
  const [s, act, pending] = useActionState(startOwnSituationAction, null);
  return (
    <Card><CardHeader><CardTitle className="text-base">{content.scenario.ask_situation}</CardTitle></CardHeader><CardContent>
      <form action={act} className="flex gap-2"><Input name="text" maxLength={120} placeholder={content.scenario.ask_placeholder} aria-label={content.scenario.ask_situation} required /><Button type="submit" size="sm" disabled={pending}>{content.scenario.ask_start}</Button></form>
      <Err s={s} />
    </CardContent></Card>
  );
}

export function LifeLogEditor({ profileId, log, staleIds, readOnly = false }: { profileId: string; log: LifeLog; staleIds: string[]; readOnly?: boolean }) {
  return (
    <div className="space-y-3" data-testid="life-log">
      <p className="text-sm text-muted-foreground">{content.log.intro}</p>
      {LIFE_FIELDS.map((f) => (
        <Card key={f}><CardHeader className="pb-2"><CardTitle className="text-base">{(content.fields as Record<string, string>)[f]}</CardTitle></CardHeader><CardContent className="space-y-2">
          <ItemList profileId={profileId} field={f} items={log[f]} staleIds={staleIds} readOnly={readOnly} showMeta />
          {!readOnly && <AddItem profileId={profileId} field={f} />}
        </CardContent></Card>
      ))}
    </div>
  );
}
