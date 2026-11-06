import Link from "next/link";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { listTasks, tagsByTask } from "@/modules/planner/service";
import { groupTasks, applyFilter, type PlannerView, type SavedFilterQuery } from "@/modules/planner/views";
import { hasTool } from "@/modules/planner/tiers";
import { QuickAdd } from "@/modules/planner/components/quick-add";
import { TaskList } from "@/modules/planner/components/task-list";
import { Alert, Badge } from "@/shared/ui";
import { planner } from "@/shared/config";
import content from "@content/planner.ar.json";
import type { PlannerSavedFilterRow } from "@/modules/planner/types";

/** P24 المخطط (ب.14): العروض الأساسية + الإدخال السريع (P33) + مستوى الأدوات. */
export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ view?: string; filter?: string }> }) {
  const sp = await searchParams;
  const s = (await getSession())!;
  const profile = s.profile!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, profile);
  const tasks = await listTasks(db, profile.id);
  const groups = groupTasks(tasks, ctx.today);
  const view = (planner.tasks.views.includes(sp.view ?? "") ? (sp.view as PlannerView) : "today");
  let shown = groups[view] ?? groups.today;
  let filterName: string | null = null;
  if (sp.filter && hasTool(ctx.tier.tier, "saved_filters")) {
    const { data: f } = await db.from("planner_saved_filters").select("*").eq("id", sp.filter).maybeSingle();
    if (f) { const row = f as PlannerSavedFilterRow; filterName = row.name; shown = applyFilter(tasks.filter((t) => !t.parent_task_id), row.query as SavedFilterQuery, await tagsByTask(db, tasks.map((t) => t.id))); }
  }
  const views: PlannerView[] = ["today", "upcoming", "overdue", "done", "list"];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{content.title}</h2>
        <Badge variant="secondary">{content.tier_label}: {ctx.tier.tier}</Badge>
        {hasTool(ctx.tier.tier, "projects") && <Link href="/app/planner/projects" className="text-sm underline">{content.projects.title}</Link>}
        {groups.overdue.length > 0 && <Link href="/app/planner/overdue" className="text-sm text-destructive underline">{content.overdue.title} ({groups.overdue.length})</Link>}
      </div>
      <p className="text-sm text-muted-foreground">{content.intro}</p>
      {ctx.tier.justUnlocked && <Alert variant="success">{content.unlocked_message}</Alert>}
      <QuickAdd ctx={{ today: ctx.today, ambiguousPmUntil: ctx.ambiguousPmUntil, weekStart: ctx.weekStart }} canUseTier1={hasTool(ctx.tier.tier, "projects")} />
      <nav className="flex flex-wrap gap-1" aria-label={content.title}>
        {views.map((v) => <Link key={v} href={`/app/planner?view=${v}`} className={`rounded-full border px-3 py-1 text-sm ${v === view && !filterName ? "bg-primary text-primary-foreground" : ""}`}>{content.views[v]} ({groups[v].length})</Link>)}
      </nav>
      {filterName && <Badge>{filterName}</Badge>}
      <TaskList tasks={shown} today={ctx.today} emptyText={content.empty[view]} />
    </div>
  );
}
