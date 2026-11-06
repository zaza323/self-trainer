"use client";
import { useActionState } from "react";
import { createProjectAction, createSectionAction, archiveProjectAction, createTagAction, deleteTagAction, saveFilterAction, deleteFilterAction, type PlannerActionResult } from "../actions";
import { plannerContent as c } from "../labels";
import type { PlannerProjectRow, PlannerSectionRow, PlannerTagRow, PlannerSavedFilterRow } from "../types";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { PLANNER_PRIORITIES } from "@/shared/config";

const Err = ({ s }: { s: PlannerActionResult | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{(c.refusals as Record<string, string>)[s.error] ?? s.error}</Alert> : null);

/** المشاريع والأقسام والوسوم والفلاتر المحفوظة (المستوى 1). */
export function ProjectsPanel({ projects, sections, tags, filters }: { projects: PlannerProjectRow[]; sections: PlannerSectionRow[]; tags: PlannerTagRow[]; filters: PlannerSavedFilterRow[] }) {
  const [ps, projAct, creating] = useActionState(createProjectAction, null);
  const [, secAct] = useActionState(createSectionAction, null);
  const [, archAct] = useActionState(archiveProjectAction, null);
  const [ts, tagAct] = useActionState(createTagAction, null);
  const [, delTagAct] = useActionState(deleteTagAction, null);
  const [fs, filterAct] = useActionState(saveFilterAction, null);
  const [, delFilterAct] = useActionState(deleteFilterAction, null);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">{c.projects.new_project}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form action={projAct} className="flex flex-wrap items-end gap-2">
            <div><Label htmlFor="pn">{c.projects.name}</Label><Input id="pn" name="name" maxLength={80} required /></div>
            <div><Label htmlFor="pc">{c.projects.context}</Label><Input id="pc" name="context_tag" maxLength={40} /></div>
            <Button type="submit" size="sm" disabled={creating}>{c.projects.new_project}</Button>
          </form>
          <Err s={ps} />
          <ul className="space-y-2">
            {projects.map((p) => (
              <li key={p.id} className="rounded-xl border p-2">
                <div className="flex flex-wrap items-center gap-2"><strong>{p.name}</strong>{p.context_tag && <span className="text-xs text-muted-foreground">{p.context_tag}</span>}
                  <form action={archAct}><input type="hidden" name="project_id" value={p.id} /><Button type="submit" size="sm" variant="ghost">{c.projects.archive}</Button></form></div>
                <div className="mt-1 text-sm text-muted-foreground">{c.projects.sections}: {sections.filter((s) => s.project_id === p.id).map((s) => s.name).join("، ") || "—"}</div>
                <form action={secAct} className="mt-1 flex gap-2"><input type="hidden" name="project_id" value={p.id} /><Input name="name" maxLength={80} required aria-label={c.projects.new_section} className="max-w-48" /><Button type="submit" size="sm" variant="outline">{c.projects.new_section}</Button></form>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{c.projects.tags_title}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <form action={tagAct} className="flex gap-2"><Input name="name" maxLength={40} required aria-label={c.projects.new_tag} className="max-w-48" /><Button type="submit" size="sm">{c.projects.new_tag}</Button></form>
          <Err s={ts} />
          <ul className="flex flex-wrap gap-2">{tags.map((t) => <li key={t.id} className="flex items-center gap-1 rounded-full border px-2 py-1 text-sm">#{t.name}<form action={delTagAct}><input type="hidden" name="tag_id" value={t.id} /><button type="submit" aria-label={c.projects.delete} className="text-muted-foreground">×</button></form></li>)}</ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{c.projects.filters_title}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form action={filterAct} className="grid gap-2 sm:grid-cols-2">
            <div><Label htmlFor="fn">{c.projects.name}</Label><Input id="fn" name="name" maxLength={60} required /></div>
            <div><Label htmlFor="fp">{c.projects.filter_priority}</Label><Select id="fp" name="priority" multiple>{PLANNER_PRIORITIES.map((p) => <option key={p} value={p}>{c.priority[p]}</option>)}</Select></div>
            <div><Label htmlFor="ff">{c.projects.filter_from}</Label><Input id="ff" name="from" type="date" dir="ltr" /></div>
            <div><Label htmlFor="ft">{c.projects.filter_to}</Label><Input id="ft" name="to" type="date" dir="ltr" /></div>
            <div><Label htmlFor="fst">{c.projects.filter_status}</Label><Select id="fst" name="status" multiple>{(["open", "done", "cancelled"] as const).map((s) => <option key={s} value={s}>{c.status[s]}</option>)}</Select></div>
            <div><Label htmlFor="fpr">{c.task.project}</Label><Select id="fpr" name="project_id"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
            <div><Label htmlFor="ftg">{c.projects.tags_title}</Label><Select id="ftg" name="tag_ids" multiple>{tags.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}</Select></div>
            <div className="flex items-end"><Button type="submit" size="sm">{c.projects.new_filter}</Button></div>
          </form>
          <Err s={fs} />
          <ul className="space-y-1 text-sm">
            {filters.map((f) => <li key={f.id} className="flex items-center gap-2"><a className="underline" href={`/app/planner?filter=${f.id}`}>{f.name}</a><form action={delFilterAct}><input type="hidden" name="filter_id" value={f.id} /><button type="submit" className="text-muted-foreground" aria-label={c.projects.delete}>×</button></form></li>)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
