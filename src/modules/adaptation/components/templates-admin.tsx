"use client";
import { useActionState } from "react";
import { reviewTemplateDraft, type SuggestionActionResult } from "../suggestion-actions";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/adaptation.ar.json";
import { customization } from "@/shared/config";

export type MetricRow = { template_id: string; template_version: number; missions_n: number; shown_rate: number; partial_rate: number; not_yet_rate: number; abandon_rate: number; transfer_rate: number; avg_prediction_error: number | null; flagged: boolean; flag_reasons: string[]; computed_at: string };
export type DraftRow = { template_id: string; template_version: number; source_version: number; rationale: string | null; status: string; created_at: string; title: string; situation: string };

const pct = (x: number) => `${Math.round(Number(x) * 100)}%`;

/** A03 فعالية القوالب (ADMIN-4) */
export function TemplateMetricsTable({ rows }: { rows: MetricRow[] }) {
  const c = content.admin.columns;
  const cfg = customization.template_metrics;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{content.admin.templates_title}</CardTitle><CardDescription>يُعلَّم عند ≥ {cfg.min_missions_to_evaluate} مهمة ونسبة «ظهرت» &lt; {pct(cfg.flag_if_shown_rate_below)}، أو تخلٍ &gt; {pct(cfg.flag_if_abandon_rate_above)}.</CardDescription></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">{content.admin.no_metrics}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-start text-xs text-muted-foreground"><th className="p-1 text-start">{c.template}</th><th className="p-1">{c.missions}</th><th className="p-1">{c.shown}</th><th className="p-1">{c.partial}</th><th className="p-1">{c.not_yet}</th><th className="p-1">{c.abandon}</th><th className="p-1">{c.transfer}</th><th className="p-1">{c.prediction}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.template_id}:${r.template_version}`} className={r.flagged ? "bg-amber-50" : ""}>
                <td className="p-1" dir="ltr"><code>{r.template_id}</code> v{r.template_version} {r.flagged && <Badge variant="warning">{content.admin.flagged}: {r.flag_reasons.map((x) => (content.admin.flag_reasons as Record<string, string>)[x] ?? x).join("، ")}</Badge>}</td>
                <td className="p-1 text-center">{r.missions_n}</td><td className="p-1 text-center">{pct(r.shown_rate)}</td><td className="p-1 text-center">{pct(r.partial_rate)}</td><td className="p-1 text-center">{pct(r.not_yet_rate)}</td><td className="p-1 text-center">{pct(r.abandon_rate)}</td><td className="p-1 text-center">{pct(r.transfer_rate)}</td><td className="p-1 text-center">{r.avg_prediction_error === null ? "—" : pct(r.avg_prediction_error)}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </CardContent>
    </Card>
  );
}

const Err = ({ s }: { s: SuggestionActionResult | null }) => (s && !s.ok ? <p className="text-xs text-destructive">{s.error}</p> : null);

/** A04 طابور مسودات القوالب (ADMIN-5): قبول/رفض. */
export function DraftsQueue({ drafts }: { drafts: DraftRow[] }) {
  const [s, act, pending] = useActionState(reviewTemplateDraft, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{content.admin.drafts_title}</CardTitle><CardDescription>{content.admin.model_switch_note}</CardDescription></CardHeader>
      <CardContent className="space-y-2">
        {drafts.length === 0 && <p className="text-sm text-muted-foreground">{content.admin.no_drafts}</p>}
        {drafts.map((d) => (
          <div key={`${d.template_id}:${d.template_version}`} className="space-y-1 rounded-lg border p-2 text-sm">
            <div><code dir="ltr">{d.template_id}</code> v{d.source_version} → v{d.template_version} <Badge variant="secondary">{d.status}</Badge></div>
            <div className="font-medium">{d.title}</div><div className="text-muted-foreground">{d.situation}</div>
            {d.rationale && <Alert className="text-xs">{d.rationale}</Alert>}
            {d.status === "pending" && (
              <form action={act} className="flex gap-2"><input type="hidden" name="template_id" value={d.template_id} /><input type="hidden" name="version" value={d.template_version} />
                <Button type="submit" name="decision" value="approved" size="sm" disabled={pending}>{content.admin.approve}</Button>
                <Button type="submit" name="decision" value="rejected" size="sm" variant="ghost" disabled={pending}>{content.admin.reject}</Button>
              </form>
            )}
          </div>
        ))}
        <Err s={s} />
      </CardContent>
    </Card>
  );
}
