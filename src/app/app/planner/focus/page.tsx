import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { effective } from "@/modules/settings";
import { loadPlannerContext } from "@/modules/planner/context";
import { hasTool } from "@/modules/planner/tiers";
import { activeFocus } from "@/modules/planner/focus-service";
import { listTasks, getTask } from "@/modules/planner/service";
import { FocusMode } from "@/modules/planner/components/phase10-panels";
import { Alert } from "@/shared/ui";
import content from "@content/planner.ar.json";

/** P29 Pomodoro ووضع التركيز (المستوى 1). */
export default async function FocusPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const { task } = await searchParams;
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  if (!hasTool(ctx.tier.tier, "pomodoro")) return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.focus.title}</h2><Alert>{content.focus.locked}</Alert></div>;
  const [active, tasks, focusMin] = await Promise.all([activeFocus(db, s.profile!.id), listTasks(db, s.profile!.id), effective<number>(db, s.profile!.id, "pomodoro_focus_min")]);
  const t = active?.task_id ? await getTask(db, active.task_id) : task ? await getTask(db, task) : null;
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.focus.title}</h2><FocusMode active={active} task={t} focusMin={focusMin.value} tasks={tasks.filter((x) => x.status === "open" && !x.parent_task_id)} /></div>;
}
