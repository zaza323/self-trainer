"use client";
import { useActionState } from "react";
import type { MapItem, MapView } from "../queries";
import { saveSelfInsights } from "../actions";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";
import phrases from "@content/phrases.ar.json";

function Sparkline({ points }: { points: Array<{ score: number }> }) {
  if (points.length < 2) return null;
  const w = 120, h = 32;
  const xs = points.map((_, i) => (i / (points.length - 1)) * w);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i]!.toFixed(1)},${(h - (p.score / 100) * h).toFixed(1)}`).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label={t("map.trajectory")} className="text-primary"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}

function CapabilityCard({ item, readOnly }: { item: MapItem; readOnly: boolean }) {
  const L = phrases.levels as { training: Record<string, string>; support: Record<string, string> };
  return (
    <Card className={item.focused ? "border-primary" : ""}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><CardTitle className="text-base">{item.name}</CardTitle><CardDescription>{item.description}</CardDescription></div>
          <div className="flex flex-wrap gap-1">
            {item.focused && <Badge>{t("map.focused")}</Badge>}
            <Badge variant="secondary">{L.training[item.training_level] ?? item.training_level}</Badge>
            <Badge variant="outline">{L.support[item.support_level] ?? item.support_level}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-2xl font-bold tabular-nums" dir="ltr">{item.confidenceBand === "unknown" ? "—" : `${item.score}%`}</div>
          <Sparkline points={item.trajectory} />
        </div>
        <p className="text-sm leading-relaxed">{item.phrase}</p>
        <p className="text-xs text-muted-foreground">{t("map.confidence")}: {item.confidenceBand === "unknown" ? "منخفضة" : item.confidenceBand === "tentative" ? "مبدئية" : "كافية"} · {item.evidence_count} دليل</p>
        {item.decline && !readOnly && (
          <Alert variant="info"><div>{item.decline.message}</div><div className="mt-1 font-medium">{item.decline.question}</div></Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function CapabilityMap({ view, readOnly = false }: { view: MapView; readOnly?: boolean }) {
  const [state, act, pending] = useActionState(saveSelfInsights, null);
  const declineQuestion = view.items.find((i) => i.decline)?.decline?.question;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{view.intro}</p>
      <div className="grid gap-3 sm:grid-cols-2">{view.items.map((i) => <CapabilityCard key={i.id} item={i} readOnly={readOnly} />)}</div>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("map.self_insights")}</CardTitle><CardDescription>{view.insightsDefault}</CardDescription></CardHeader>
        <CardContent>
          {readOnly ? <p className="text-sm whitespace-pre-wrap">{view.insights.text || "—"}</p> : (
            <form action={act} className="space-y-2">
              <textarea name="text" defaultValue={view.insights.text} rows={3} maxLength={2000} className="w-full rounded-xl border border-input bg-background p-3" aria-label={t("map.self_insights")} />
              {declineQuestion && <div className="space-y-1"><Label htmlFor="decline_answer">{declineQuestion}</Label><textarea id="decline_answer" name="decline_answer" rows={2} maxLength={500} className="w-full rounded-xl border border-input bg-background p-3" placeholder={t("map.decline_answer")} /></div>}
              <div className="flex items-center gap-2"><Button type="submit" size="sm" disabled={pending}>{t("map.edit_insights")}</Button>{state?.ok && <span className="text-xs text-emerald-700">{t("map.saved")}</span>}{state && !state.ok && <span className="text-xs text-destructive">{t("common.error_generic")}</span>}</div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
