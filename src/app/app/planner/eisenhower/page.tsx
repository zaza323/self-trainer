import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { hasTool } from "@/modules/planner/tiers";
import { listTasks } from "@/modules/planner/service";
import { Eisenhower } from "@/modules/planner/components/phase10-panels";
import { Alert } from "@/shared/ui";
import content from "@content/planner.ar.json";

/** P28 مصفوفة أيزنهاور (المستوى 2). */
export default async function EisenhowerPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  if (!hasTool(ctx.tier.tier, "eisenhower")) return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.eisenhower.title}</h2><Alert>{content.eisenhower.locked}</Alert></div>;
  const tasks = (await listTasks(db, s.profile!.id)).filter((t) => t.status === "open" && !t.parent_task_id);
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.eisenhower.title}</h2><Eisenhower tasks={tasks} /></div>;
}
