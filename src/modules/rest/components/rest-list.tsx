"use client";
import { useActionState } from "react";
import { startRestAction, addCustomRestAction } from "../actions";
import type { RestSuggestion } from "../suggest";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import content from "@content/rest_activities.ar.json";
import type { AgeMode } from "@/shared/config";

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(v[k] ?? ""));
type Act = typeof content.activities;

/** P41 قائمة الراحة: 3–4 أنشطة وزر «المزيد»؛ بطاقة توعية مرة واحدة؛ لا ممنوعات؛ لا XP. */
export function RestList({ shown, more, ageMode, source, firstUse, windDown, outcomes }: { shown: RestSuggestion[]; more: RestSuggestion[]; ageMode: AgeMode; source: string; firstUse: boolean; windDown: boolean; outcomes: Record<string, { uses: number; felt_more_count: number }> }) {
  const [, act, pending] = useActionState(startRestAction, null);
  const [c, customAct] = useActionState(addCustomRestAction, null);
  const Item = ({ s }: { s: RestSuggestion }) => {
    const a = (content.activities as Act)[(s.key in content.activities ? s.key : "custom") as keyof Act];
    const mem = outcomes[s.key];
    return (
      <Card data-testid={`rest-${s.key}`}><CardContent className="space-y-2 p-3">
        <div className="font-medium">{s.title ?? a.name}</div>
        <div className="text-xs text-muted-foreground">{a.description[ageMode]}{mem && mem.uses >= 3 && mem.felt_more_count / mem.uses >= 0.5 ? ` · ${fill(content.memory_hint, { activity: s.title ?? a.name, n: mem.felt_more_count })}` : ""}</div>
        <div className="flex flex-wrap gap-1">
          {(s.key === "sleep_early" ? [0] : s.durations).map((m) => (
            <form key={m} action={act}><input type="hidden" name="activity_key" value={s.key} />{s.customId && <input type="hidden" name="custom_id" value={s.customId} />}<input type="hidden" name="minutes" value={m} /><input type="hidden" name="source" value={source} />
              <Button size="sm" variant="outline" type="submit" disabled={pending}>{s.key === "sleep_early" ? content.start : fill(content.minutes, { n: m })}</Button></form>
          ))}
        </div>
      </CardContent></Card>
    );
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{windDown ? content.wind_down.message : content.intro[ageMode]}</p>
      {firstUse && <Alert className="text-sm" data-testid="rest-awareness">{content.awareness_card}</Alert>}
      <div className="grid gap-2 sm:grid-cols-2">{shown.map((s) => <Item key={s.customId ?? s.key} s={s} />)}</div>
      {more.length > 0 && <details><summary className="cursor-pointer text-sm">{content.more}</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{more.map((s) => <Item key={s.customId ?? s.key} s={s} />)}</div></details>}
      <Card><CardHeader><CardTitle className="text-base">{content.custom_add.title}</CardTitle><CardDescription>{content.no_xp_note} {content.privacy}</CardDescription></CardHeader>
        <CardContent><form action={customAct} className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="cn">{content.custom_add.name}</Label><Input id="cn" name="title" maxLength={80} required /></div>
          <div><Label htmlFor="cm">{content.custom_add.minutes}</Label><Input id="cm" name="default_min" type="number" dir="ltr" min={1} max={180} defaultValue={15} /></div>
          <Button size="sm" type="submit">{content.custom_add.save}</Button>{c?.ok && <span className="text-xs text-muted-foreground">✓</span>}
        </form></CardContent></Card>
    </div>
  );
}
