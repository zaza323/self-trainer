import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { hasTool } from "@/modules/planner/tiers";
import { listHabits } from "@/modules/planner/habits-service";
import { HabitsPanel } from "@/modules/planner/components/phase10-panels";
import { Alert } from "@/shared/ui";
import content from "@content/planner.ar.json";

/** P30 العادات (المستوى 1). */
export default async function HabitsPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  if (!hasTool(ctx.tier.tier, "habits")) return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.habits.title}</h2><Alert>{content.habits.locked}</Alert></div>;
  const habits = await listHabits(db, s.profile!.id, ctx.today, ctx.weekStart);
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.habits.title}</h2><HabitsPanel habits={habits} /></div>;
}
