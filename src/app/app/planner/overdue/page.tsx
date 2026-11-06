import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { listTasks } from "@/modules/planner/service";
import { groupTasks } from "@/modules/planner/views";
import { TaskList } from "@/modules/planner/components/task-list";
import { MoveAllButton } from "@/modules/planner/components/overdue-actions";
import content from "@content/planner.ar.json";

/** P34 المتأخر (ب.10): لا إعادة جدولة تلقائية؛ لكل مهمة قرار، وزر جماعي كفعل من المستخدم. */
export default async function OverduePage() {
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  const overdue = groupTasks(await listTasks(db, s.profile!.id), ctx.today).overdue;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{content.overdue.title}</h2>
      <p className="text-sm text-muted-foreground">{content.overdue.intro}</p>
      {overdue.length > 0 && <MoveAllButton />}
      <TaskList tasks={overdue} today={ctx.today} emptyText={content.overdue.none} />
    </div>
  );
}
