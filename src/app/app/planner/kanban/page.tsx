import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { hasTool } from "@/modules/planner/tiers";
import { listTasks } from "@/modules/planner/service";
import { KanbanBoard } from "@/modules/planner/components/phase10-panels";
import { Alert } from "@/shared/ui";
import content from "@content/planner.ar.json";
import type { PlannerSectionRow } from "@/modules/planner/types";

/** P27 Kanban (المستوى 2). */
export default async function KanbanPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  if (!hasTool(ctx.tier.tier, "kanban")) return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.kanban.title}</h2><Alert>{content.kanban.locked}</Alert></div>;
  const tasks = (await listTasks(db, s.profile!.id)).filter((t) => !t.parent_task_id && t.status !== "cancelled" && (!project || t.project_id === project));
  const { data: sections } = project ? await db.from("planner_sections").select("*").eq("project_id", project).order("order", { ascending: true }) : { data: [] };
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.kanban.title}</h2><KanbanBoard tasks={tasks} sections={(sections ?? []) as PlannerSectionRow[]} /></div>;
}
