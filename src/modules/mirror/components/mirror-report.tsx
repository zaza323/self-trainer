"use client";
import { useActionState, useState } from "react";
import { noticedAction, chooseChangeAction } from "../actions";
import type { MirrorReportRow } from "../service";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import content from "@content/mirror.ar.json";
import cats from "@content/reconstruction_categories.ar.json";

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const label = (k: string) => (cats.labels as Record<string, string>)[k] ?? k;
const hrs = (m: number) => (m / 60).toFixed(1);

/** P50 المرآة + P51 تغيير واحد: «مش حكم، صورة». المستخدم يلاحظ أولًا؛ الأنماط تُعرض بعد جوابه كأسئلة؛ لا أحمر ولا «ضيّعت». */
export function MirrorReport({ report, supportBand }: { report: MirrorReportRow; supportBand: "L0_L1" | "L2_L3" }) {
  const [n, noticeAct, noticing] = useActionState(noticedAction, null);
  const [c, changeAct, changing] = useActionState(chooseChangeAction, null);
  const [noticed, setNoticed] = useState(Boolean(report.user_noticed));
  const total = Object.values(report.distribution).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(report.distribution).sort((a, b) => b[1] - a[1]);
  const changed = Boolean(report.chosen_change_text) || Boolean(c?.ok);
  return (
    <div className="space-y-4" data-testid="mirror-report">
      <h2 className="text-lg font-semibold">{content.mirror_title}</h2>
      <p className="text-xs text-muted-foreground">{fill(content.days_count, { n: report.days_count })} · {report.period_start} → {report.period_end}</p>
      <Card><CardHeader><CardTitle className="text-base">{content.sections.distribution}</CardTitle></CardHeader><CardContent>
        <ul className="space-y-1 text-sm">{sorted.map(([k, m]) => <li key={k} className="flex items-center gap-2"><span className="w-28">{label(k)}</span><span className="h-3 rounded bg-primary/40" style={{ width: `${Math.max(2, Math.round((m / total) * 100))}%` }} aria-hidden /><span dir="ltr" className="text-xs text-muted-foreground">{hrs(m)} {content.columns.hours}</span></li>)}</ul>
        <p className="mt-2 text-xs text-muted-foreground">{content.valued_note}</p>
      </CardContent></Card>
      {report.predictions.length > 0 && <Card><CardHeader><CardTitle className="text-base">{content.sections.prediction_vs_reality}</CardTitle></CardHeader><CardContent>
        <table className="w-full text-sm"><thead><tr><th className="text-start">{content.columns.category}</th><th>{content.columns.predicted}</th><th>{content.columns.actual}</th></tr></thead>
        <tbody>{report.predictions.map((p) => <tr key={p.category}><td>{label(p.category)}</td><td className="text-center" dir="ltr">{p.predicted_hours}</td><td className="text-center" dir="ltr">{p.actual_hours}</td></tr>)}</tbody></table>
      </CardContent></Card>}
      {report.goal_alignment.length > 0 && <Card><CardHeader><CardTitle className="text-base">{content.sections.goals_vs_time}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
        {report.goal_alignment.map((g) => <p key={g.goal_id}>{g.minutes > 0 ? fill(content.goal_line, { goal: g.title, minutes: g.minutes }) : `${g.title}: ${content.goal_no_time}`}</p>)}
      </CardContent></Card>}
      <Card className="border-primary/40"><CardHeader><CardTitle className="text-base">{content.notice_question}</CardTitle></CardHeader><CardContent className="space-y-2">
        {!noticed ? <form action={noticeAct} className="space-y-2" onSubmit={() => setNoticed(true)}><input type="hidden" name="report_id" value={report.id} /><Label htmlFor="nt">{content.notice_hint}</Label><textarea id="nt" name="text" rows={2} maxLength={1000} required className="w-full rounded-xl border border-input bg-background p-3" /><Button size="sm" type="submit" disabled={noticing}>{content.change.save === "" ? "" : "تم"}</Button></form>
          : <>
            <p className="text-sm">{report.user_noticed ?? (n?.ok ? "✓" : "")}</p>
            <div className="space-y-1" data-testid="patterns">{report.patterns.map((p, i) => <p key={i} className="text-sm">{fill((content.pattern_questions as Record<string, string>)[p.rule] ?? "", { category: label(p.category ?? ""), minutes: p.minutes ?? "", hour: p.hour ?? "", share: Math.round((p.share ?? 0) * 100), hours: (p.hours ?? []).join("، ") })}</p>)}</div>
          </>}
      </CardContent></Card>
      {noticed && <Card><CardHeader><CardTitle className="text-base">{content.change.title}</CardTitle></CardHeader><CardContent>
        {changed ? <Alert variant="success">{content.change.saved}</Alert> : (
          <form action={changeAct} className="space-y-2"><input type="hidden" name="report_id" value={report.id} />
            <Label htmlFor="ch">{content.change.question}</Label>
            {supportBand === "L0_L1" && report.patterns.length > 0 && <div className="flex flex-wrap gap-1">{report.patterns.map((p, i) => <Button key={i} size="sm" variant="outline" type="button" onClick={() => { const el = document.getElementById("ch") as HTMLInputElement | null; if (el) el.value = label(p.category ?? ""); }}>{label(p.category ?? p.rule)}</Button>)}</div>}
            <Input id="ch" name="text" maxLength={300} required placeholder={content.change.hint} />
            <Button size="sm" type="submit" disabled={changing}>{content.change.save}</Button>
          </form>
        )}
      </CardContent></Card>}
    </div>
  );
}
