import { notFound } from "next/navigation";
import Link from "next/link";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { todayIn } from "@/modules/missions/queries";
import { addDays } from "@/modules/planner/recurrence";
import { GuardianAddTask } from "@/modules/planner/components/guardian-add-task";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/planner.ar.json";
import type { PlannerTaskRow } from "@/modules/planner/types";

/** G14 مخطط الطفل (ب.12): قراءة بصلاحية view_planner (RLS)، وإضافة مهمة بصلاحية add_missions. */
export default async function GuardianPlannerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link) notFound();
  const canView = link.is_creator && player.age_mode === "child" ? true : Boolean(link.permissions.view_planner);
  const canAdd = link.is_creator || link.permissions.add_missions;
  const g = content.guardian;
  const db = await createClient();
  const today = todayIn(player.timezone);
  const { data } = canView ? await db.from("planner_tasks").select("*").eq("profile_id", playerId).is("parent_task_id", null).order("due_date", { ascending: true, nullsFirst: false }).limit(200) : { data: [] };
  const tasks = (data ?? []) as PlannerTaskRow[];
  const open = tasks.filter((t) => t.status === "open");
  const doneWeek = tasks.filter((t) => t.status === "done" && t.completed_at && t.completed_at.slice(0, 10) >= addDays(today, -7));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{g.title.replace("{name}", player.display_name ?? "")}</h2>
        {player.age_mode === "child" && <Link href={`/guardian/${playerId}/pace`} className="text-sm underline">{g.pace_link}</Link>}</div>
      <p className="text-sm text-muted-foreground">{g.intro}</p>
      {!canView ? <Alert>{g.no_permission}</Alert> : (
        <>
          <Card><CardHeader><CardTitle className="text-base">{g.open} ({open.length})</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
            {!open.length ? <p className="text-muted-foreground">{g.none}</p> : open.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2"><span>{t.title}</span>{t.priority !== "none" && <Badge variant="secondary">{content.priority[t.priority]}</Badge>}{t.due_date && <Badge variant={t.due_date < today ? "warning" : "muted"} dir="ltr">{t.due_date}</Badge>}{t.created_via === "guardian" && <Badge variant="muted">{content.task.created_by_guardian}</Badge>}</div>
            ))}
          </CardContent></Card>
          <p className="text-sm text-muted-foreground">{g.done_week}: {doneWeek.length}</p>
        </>
      )}
      {canAdd && <Card><CardHeader><CardTitle className="text-base">{g.add_title}</CardTitle></CardHeader><CardContent><GuardianAddTask profileId={playerId} /></CardContent></Card>}
    </div>
  );
}
