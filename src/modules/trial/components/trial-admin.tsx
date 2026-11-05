"use client";
import { useActionState } from "react";
import { createCohort, enrollParticipant, computeNow, type TrialActionResult } from "../actions";
import type { CohortRow, ReadinessItem } from "../service";
import type { MetricStatus, Warning } from "../metrics";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import content from "@content/trial.ar.json";
import { trial } from "@/shared/config";

const Err = ({ s }: { s: TrialActionResult | null }) => (s && !s.ok ? <p className="text-xs text-destructive">{(content.admin.errors as Record<string, string>)[s.error] ?? s.error}</p> : null);
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export type Snapshot = { week: number; metrics: MetricStatus[]; warnings: Warning[]; participants: number; computed_at: string };

/** A08 التجربة المغلقة: الدفعة والتوزيع، مقاييس القسم 15 ضد أهدافها، التحذيران المضادان، اللقطات، الجاهزية. */
export function TrialAdmin({ cohort, byMode, participants, latest, snapshots, readiness }: { cohort: CohortRow | null; byMode: Record<string, number>; participants: number; latest: Snapshot | null; snapshots: Snapshot[]; readiness: ReadinessItem[] }) {
  const [c, createAct, creating] = useActionState(createCohort, null);
  const [e, enrollAct, enrolling] = useActionState(enrollParticipant, null);
  const [, computeAct, computing] = useActionState(async () => computeNow(), null);
  const modes = trial.cohort.enabled_age_modes;
  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="text-base">{content.admin.cohort}</CardTitle><CardDescription>{trial.cohort.min_users}–{trial.cohort.max_users} مستخدمًا، {trial.cohort.weeks} أسابيع، الأوضاع: {modes.join("، ")}</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!cohort ? (
            <form action={createAct} className="flex flex-wrap items-end gap-2"><div className="space-y-1"><Label htmlFor="name">{content.admin.name_label}</Label><Input id="name" name="name" maxLength={60} /></div><Button type="submit" size="sm" disabled={creating}>{content.admin.create}</Button><Err s={c} /></form>
          ) : (
            <>
              <div><strong>{cohort.name}</strong> · <Badge variant="secondary">{cohort.status}</Badge> · بدأت {new Date(cohort.starts_at).toLocaleDateString("ar")} · {content.admin.participants}: {participants}/{cohort.max_users} {participants < trial.cohort.min_users && <Badge variant="warning">أقل من الحد الأدنى {trial.cohort.min_users}</Badge>}</div>
              <div>{content.admin.distribution}: {modes.map((m) => <Badge key={m} variant={(byMode[m] ?? 0) >= trial.cohort.min_users_per_enabled_mode ? "success" : "warning"} className="ms-1">{m}: {byMode[m] ?? 0}</Badge>)}</div>
              <form action={enrollAct} className="flex flex-wrap items-end gap-2"><input type="hidden" name="cohort_id" value={cohort.id} /><div className="space-y-1"><Label htmlFor="pid">{content.admin.profile_id_label}</Label><Input id="pid" name="profile_id" dir="ltr" className="min-w-80" /></div><Button type="submit" size="sm" variant="outline" disabled={enrolling}>{content.admin.enroll}</Button><Err s={e} /></form>
              <form action={computeAct}><Button type="submit" size="sm" disabled={computing}>{content.admin.compute_now}</Button></form>
            </>
          )}
          {!cohort && <p className="text-muted-foreground">{content.admin.no_cohort}</p>}
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{content.admin.metrics_title}{latest ? ` — ${content.admin.week} ${latest.week}` : ""}</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {!latest ? <p className="text-muted-foreground">{content.admin.no_snapshots}</p> : (
            <table className="w-full"><thead><tr className="text-xs text-muted-foreground"><th className="p-1 text-start">{content.admin.columns.metric}</th><th className="p-1">{content.admin.columns.value}</th><th className="p-1">{content.admin.columns.target}</th><th className="p-1">{content.admin.columns.n}</th><th className="p-1">{content.admin.columns.status}</th></tr></thead>
              <tbody>{latest.metrics.map((m) => (
                <tr key={m.key}><td className="p-1">{(content.admin.metrics as Record<string, string>)[m.key] ?? m.key}{m.note && <span className="ms-1 text-xs text-muted-foreground" dir="ltr">{m.note}</span>}</td><td className="p-1 text-center" dir="ltr">{m.key === "mastery_over_achievement" ? (m.value === null ? "—" : (m.value > 0 ? "+" : "") + m.value) : pct(m.value)}</td><td className="p-1 text-center" dir="ltr">{m.key === "mastery_over_achievement" ? "> 0" : m.key === "novel_context" ? `≤ ${pct(m.target)}` : `≥ ${pct(m.target)}`}</td><td className="p-1 text-center">{m.n}</td><td className="p-1 text-center"><Badge variant={m.met === null ? "muted" : m.met ? "success" : "warning"}>{m.met === null ? content.admin.status.na : m.met ? content.admin.status.met : content.admin.status.not_met}</Badge></td></tr>
              ))}</tbody></table>
          )}
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{content.admin.warnings_title}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {!latest || latest.warnings.length === 0 ? <p className="text-muted-foreground">{content.admin.no_warnings}</p> : latest.warnings.map((w) => <Alert key={w.key} variant="warning">{(content.admin.warnings as Record<string, string>)[w.key]} ({w.profiles})</Alert>)}
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{content.admin.snapshots}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">{snapshots.length === 0 ? content.admin.no_snapshots : snapshots.map((s) => <div key={s.week}>{content.admin.week} {s.week} · {s.participants} · {new Date(s.computed_at).toLocaleString("ar")} · {s.metrics.filter((m) => m.met).length}/{s.metrics.length} محقق · {s.warnings.length} تحذير</div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{content.admin.readiness_title}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">{readiness.map((r) => <div key={r.key} className="flex justify-between gap-2"><span dir="ltr">{r.key}{r.detail ? ` (${r.detail})` : ""}</span><Badge variant={r.ok ? "success" : "warning"}>{r.ok ? content.admin.ok : content.admin.missing}</Badge></div>)}</CardContent></Card>
    </div>
  );
}
