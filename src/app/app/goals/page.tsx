import Link from "next/link";
import { getSession } from "@/modules/accounts";
import { getGoals, nearestActiveGoal } from "@/modules/goals";
import { GoalsTree } from "@/modules/goals/components/goals-tree";
import { Alert, Button } from "@/shared/ui";
import { t } from "@/shared/i18n";

/** P13 سلسلة غاياتي (بلا ذكاء اصطناعي): عرض وتحرير الشجرة. */
export default async function GoalsPage() {
  const s = (await getSession())!;
  const goals = await getGoals(s.profile!.id);
  const nearest = nearestActiveGoal(goals);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("goals.title")}</h2><Button asChild size="sm" variant="outline"><Link href="/app/goals/new">{t("goals.new")}</Link></Button></div>
      {nearest && <Alert>{t("goals.nearest")}: <strong>{nearest.title}</strong></Alert>}
      {goals.length === 0 ? <Alert>{t("goals.no_goals")} <Link className="underline" href="/app/goals/new">{t("goals.first_goal_cta")}</Link></Alert> : <GoalsTree goals={goals} />}
    </div>
  );
}
