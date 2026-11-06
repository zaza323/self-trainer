import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { loadProjectsAndTags } from "@/modules/planner/service";
import { hasTool } from "@/modules/planner/tiers";
import { ProjectsPanel } from "@/modules/planner/components/projects-panel";
import { Alert } from "@/shared/ui";
import content from "@content/planner.ar.json";
import type { PlannerSectionRow, PlannerSavedFilterRow } from "@/modules/planner/types";

/** المشاريع والوسوم والفلاتر (المستوى 1 — ب.2): لا تظهر قبل الانفتاح. */
export default async function ProjectsPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  if (!hasTool(ctx.tier.tier, "projects")) return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.projects.title}</h2><Alert>{content.projects.locked}</Alert></div>;
  const { projects, tags } = await loadProjectsAndTags(db, s.profile!.id);
  const ids = projects.map((p) => p.id);
  const [{ data: sections }, { data: filters }] = await Promise.all([
    ids.length ? db.from("planner_sections").select("*").in("project_id", ids).order("order", { ascending: true }) : Promise.resolve({ data: [] }),
    db.from("planner_saved_filters").select("*").eq("profile_id", s.profile!.id),
  ]);
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.projects.title}</h2><ProjectsPanel projects={projects} sections={(sections ?? []) as PlannerSectionRow[]} tags={tags} filters={(filters ?? []) as PlannerSavedFilterRow[]} /></div>;
}
