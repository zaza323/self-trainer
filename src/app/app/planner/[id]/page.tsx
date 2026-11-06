import { notFound } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { getTask, listReminders, loadProjectsAndTags } from "@/modules/planner/service";
import { hasTool } from "@/modules/planner/tiers";
import { TaskDetail } from "@/modules/planner/components/task-detail";
import type { PlannerTaskRow, PlannerChecklistRow, PlannerSectionRow } from "@/modules/planner/types";

/** P25 تفاصيل المهمة. ?reminder= يبرز التذكير الذي فتح الإشعار (Snooze). */
export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reminder?: string }> }) {
  const { id } = await params;
  const { reminder } = await searchParams;
  const s = (await getSession())!;
  const profile = s.profile!;
  const db = await createClient();
  const task = await getTask(db, id);
  if (!task || task.profile_id !== profile.id) notFound();
  const ctx = await loadPlannerContext(db, profile);
  const [{ data: subs }, { data: checklist }, reminders, { projects }] = await Promise.all([
    db.from("planner_tasks").select("*").eq("parent_task_id", id).order("created_at", { ascending: true }),
    db.from("planner_checklist_items").select("*").eq("task_id", id).order("order", { ascending: true }),
    listReminders(db, id), loadProjectsAndTags(db, profile.id),
  ]);
  const { data: sections } = task.project_id ? await db.from("planner_sections").select("*").eq("project_id", task.project_id).order("order", { ascending: true }) : { data: [] };
  return <TaskDetail task={task} subtasks={(subs ?? []) as PlannerTaskRow[]} checklist={(checklist ?? []) as PlannerChecklistRow[]} reminders={reminders} projects={projects} sections={(sections ?? []) as PlannerSectionRow[]}
    ctx={{ today: ctx.today, ambiguousPmUntil: ctx.ambiguousPmUntil, weekStart: ctx.weekStart }} canUseTier1={hasTool(ctx.tier.tier, "projects")} today={ctx.today} highlightReminder={reminder ?? null} />;
}
