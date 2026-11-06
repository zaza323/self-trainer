/**
 * خدمة المخطط (المرحلة 9): كل الكتابات عبر عميل المستخدم (RLS)، إلا تنفيذ التذكيرات في الدورة المجدولة (عميل الخدمة).
 * القواعد: المهام الفرعية بعمق 1، التكرار يولّد المهمة التالية عند الإنجاز، التأجيل بلا عقوبة مع سؤال واحد بعد N مرات،
 * التذكيرات خارج حد الإشعارات (ب.5)، مستويات الأدوات لا تُغلق بعد الانفتاح.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { planner, type AgeMode, type PlannerPriority } from "@/shared/config";
import { effective } from "@/modules/settings";
import { avgSupport } from "@/modules/game/stage";
import { todayIn } from "@/modules/missions/queries";
import { nextOccurrence, serializeRRule, isAllowedRecurrence, type Recurrence, type RecurFrom, type WeekStart } from "./recurrence";
import { reminderFireAt, snoozeUntil, type ReminderSpec, type SnoozeOption } from "./reminders";
import { plannerTier, toolsForTier, type PlannerTier, type TierResult } from "./tiers";
import type { PlannerTaskRow, PlannerReminderRow, PlannerTagRow, PlannerProjectRow } from "./types";

type Db = SupabaseClient;
export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): Result<never> => ({ ok: false, error });

export const REMINDER_NOTIFICATION_TYPE = "planner_reminder";

export type NewTaskInput = {
  profileId: string;
  title: string;
  notes?: string | null;
  priority?: PlannerPriority;
  due_date?: string | null;
  due_time?: string | null;
  estimate_min?: number | null;
  recurrence?: Recurrence | null;
  recur_from?: RecurFrom | null;
  project_id?: string | null;
  project_name?: string | null;     // من الإدخال السريع: يُنشأ إن لم يوجد (المستوى 1)
  section_id?: string | null;
  parent_task_id?: string | null;
  tags?: string[];                  // أسماء؛ تُنشأ إن لم توجد
  reminders?: ReminderSpec[];
  created_via?: PlannerTaskRow["created_via"];
  created_by?: string | null;
  important?: boolean; urgent?: boolean;
  linked_goal_id?: string | null;
  weekStart: WeekStart;
  tz: string;
};

async function ensureTags(db: Db, profileId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const { data: ex } = await db.from("planner_tags").select("id").eq("profile_id", profileId).eq("name", name).maybeSingle();
    if (ex) { ids.push(ex.id as string); continue; }
    const { data, error } = await db.from("planner_tags").insert({ profile_id: profileId, name }).select("id").single();
    if (error) throw error;
    ids.push(data.id as string);
  }
  return ids;
}

export async function ensureProject(db: Db, profileId: string, name: string): Promise<string> {
  const { data: ex } = await db.from("planner_projects").select("id").eq("profile_id", profileId).eq("name", name.trim()).maybeSingle();
  if (ex) return ex.id as string;
  const { data, error } = await db.from("planner_projects").insert({ profile_id: profileId, name: name.trim() }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function createTask(db: Db, i: NewTaskInput): Promise<Result<{ id: string }>> {
  const title = i.title.trim();
  if (!title) return fail("title_required");
  if (i.recurrence && !isAllowedRecurrence(i.recurrence)) return fail("recurrence_not_allowed");
  if (i.parent_task_id) {
    const { data: parent } = await db.from("planner_tasks").select("parent_task_id, profile_id").eq("id", i.parent_task_id).maybeSingle();
    if (!parent || parent.profile_id !== i.profileId) return fail("parent_not_found");
    if (parent.parent_task_id) return fail("subtask_depth");
  }
  let projectId = i.project_id ?? null;
  if (!projectId && i.project_name) projectId = await ensureProject(db, i.profileId, i.project_name);
  const row = {
    profile_id: i.profileId, title, notes: i.notes ?? null, priority: i.priority ?? "none", due_date: i.due_date ?? null, due_time: i.due_time ?? null,
    estimate_min: i.estimate_min ?? null, recurrence_rrule: i.recurrence ? serializeRRule(i.recurrence, i.weekStart) : null,
    recur_from: i.recur_from ?? "schedule", project_id: projectId, section_id: i.section_id ?? null, parent_task_id: i.parent_task_id ?? null,
    created_via: i.created_via ?? "manual", created_by: i.created_by ?? null, important: i.important ?? false, urgent: i.urgent ?? false, linked_goal_id: i.linked_goal_id ?? null,
  };
  const { data, error } = await db.from("planner_tasks").insert(row).select("id").single();
  if (error) return fail(error.message);
  const id = data.id as string;
  if (i.tags?.length) {
    const tagIds = await ensureTags(db, i.profileId, i.tags);
    if (tagIds.length) await db.from("planner_task_tags").insert(tagIds.map((tag_id) => ({ task_id: id, tag_id })));
  }
  for (const r of (i.reminders ?? []).slice(0, planner.reminders.max_per_task)) {
    const at = reminderFireAt(r, { due_date: row.due_date, due_time: row.due_time }, i.tz);
    if (!at) continue;
    await db.from("planner_reminders").insert({ task_id: id, kind: r.kind, at: at.toISOString(), offset_min: r.kind === "relative" ? r.offset_min : null, important: r.important ?? false });
  }
  return { ok: true, data: { id } };
}

export async function getTask(db: Db, id: string): Promise<PlannerTaskRow | null> {
  const { data } = await db.from("planner_tasks").select("*").eq("id", id).maybeSingle();
  return (data as PlannerTaskRow | null) ?? null;
}

export async function listTasks(db: Db, profileId: string): Promise<PlannerTaskRow[]> {
  const { data, error } = await db.from("planner_tasks").select("*").eq("profile_id", profileId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlannerTaskRow[];
}

export async function updateTask(db: Db, id: string, patch: Partial<Pick<PlannerTaskRow, "title" | "notes" | "priority" | "due_date" | "due_time" | "estimate_min" | "project_id" | "section_id" | "important" | "urgent" | "kanban_column" | "recurrence_rrule" | "recur_from" | "linked_goal_id">>): Promise<Result> {
  const { data, error } = await db.from("planner_tasks").update(patch).eq("id", id).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("not_allowed");
  return { ok: true, data: undefined };
}

/** إنجاز (ب.3): المدة الفعلية اختيارية؛ المهمة المتكررة تولّد التالية (ب.18-2) وتنسخ وسومها. */
export async function completeTask(db: Db, i: { taskId: string; actualMin?: number | null; tz: string; weekStart: WeekStart; now?: Date }): Promise<Result<{ nextTaskId: string | null; task: PlannerTaskRow }>> {
  const task = await getTask(db, i.taskId);
  if (!task) return fail("not_found");
  if (task.status === "done") return { ok: true, data: { nextTaskId: null, task } };
  const now = i.now ?? new Date();
  const { data: upd, error } = await db.from("planner_tasks").update({ status: "done", completed_at: now.toISOString(), actual_min: i.actualMin ?? task.actual_min }).eq("id", task.id).select("*");
  if (error) return fail(error.message);
  if (!upd?.length) return fail("not_allowed");
  let nextTaskId: string | null = null;
  const nextDate = nextOccurrence({ rrule: task.recurrence_rrule, recurFrom: task.recur_from, dueDate: task.due_date, completedOn: todayIn(i.tz, now), weekStart: i.weekStart });
  if (nextDate && !task.parent_task_id) {
    const { data: created, error: e2 } = await db.from("planner_tasks").insert({
      profile_id: task.profile_id, project_id: task.project_id, section_id: task.section_id, title: task.title, notes: task.notes, priority: task.priority,
      due_date: nextDate, due_time: task.due_time, estimate_min: task.estimate_min, recurrence_rrule: task.recurrence_rrule, recur_from: task.recur_from,
      important: task.important, urgent: task.urgent, created_via: task.created_via, created_by: task.created_by, linked_goal_id: task.linked_goal_id,
    }).select("id").single();
    if (e2) return fail(e2.message);
    nextTaskId = created.id as string;
    const { data: tags } = await db.from("planner_task_tags").select("tag_id").eq("task_id", task.id);
    if (tags?.length) await db.from("planner_task_tags").insert((tags as Array<{ tag_id: string }>).map((t) => ({ task_id: nextTaskId, tag_id: t.tag_id })));
    // التذكيرات النسبية تُعاد للتكرار التالي بنفس الإزاحة
    const { data: rems } = await db.from("planner_reminders").select("offset_min, important").eq("task_id", task.id).eq("kind", "relative");
    for (const r of (rems ?? []) as Array<{ offset_min: number; important: boolean }>) {
      const at = reminderFireAt({ kind: "relative", offset_min: r.offset_min }, { due_date: nextDate, due_time: task.due_time }, i.tz);
      if (at) await db.from("planner_reminders").insert({ task_id: nextTaskId, kind: "relative", at: at.toISOString(), offset_min: r.offset_min, important: r.important });
    }
  }
  return { ok: true, data: { nextTaskId, task: (upd[0] as PlannerTaskRow) } };
}

export async function reopenTask(db: Db, id: string): Promise<Result> {
  const { data, error } = await db.from("planner_tasks").update({ status: "open", completed_at: null, cancel_reason: null }).eq("id", id).select("id");
  if (error) return fail(error.message);
  return data?.length ? { ok: true, data: undefined } : fail("not_allowed");
}

/** التأجيل بلا عقوبة (ب.8): يزيد العدّاد؛ عند بلوغ الحد يُطلب سؤال «شو اللي عم يأخّر هالمهمة؟» مرة واحدة. */
export async function postponeTask(db: Db, i: { taskId: string; newDate: string; auto?: boolean }): Promise<Result<{ postponeCount: number; prompt: boolean }>> {
  const task = await getTask(db, i.taskId);
  if (!task) return fail("not_found");
  if (task.status !== "open") return fail("bad_state");
  const postponeCount = task.postpone_count + 1;
  const { data, error } = await db.from("planner_tasks").update({ due_date: i.newDate, postpone_count: postponeCount, auto_rescheduled: Boolean(i.auto) }).eq("id", task.id).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("not_allowed");
  const prompt = postponeCount >= planner.tasks.postpone_prompt_after && !task.postpone_prompted;
  return { ok: true, data: { postponeCount, prompt } };
}

export async function markPostponePrompted(db: Db, taskId: string): Promise<void> {
  await db.from("planner_tasks").update({ postpone_prompted: true }).eq("id", taskId);
}

/** إلغاء واعٍ مع سبب (ب.11 P5 لاحقًا). */
export async function cancelTask(db: Db, i: { taskId: string; reason: string | null }): Promise<Result> {
  const { data, error } = await db.from("planner_tasks").update({ status: "cancelled", cancel_reason: i.reason?.trim() || null }).eq("id", i.taskId).select("id");
  if (error) return fail(error.message);
  return data?.length ? { ok: true, data: undefined } : fail("not_allowed");
}

/** المتأخر (ب.10): زر جماعي «انقل الكل لليوم» كفعل من المستخدم (ليس تلقائيًا، فلا يُعلَّم auto_rescheduled). */
export async function moveOverdueToToday(db: Db, profileId: string, today: string): Promise<Result<{ moved: number }>> {
  const { data, error } = await db.from("planner_tasks").select("id, postpone_count").eq("profile_id", profileId).eq("status", "open").lt("due_date", today);
  if (error) return fail(error.message);
  let moved = 0;
  for (const t of (data ?? []) as Array<{ id: string; postpone_count: number }>) {
    const { data: u } = await db.from("planner_tasks").update({ due_date: today, postpone_count: t.postpone_count + 1 }).eq("id", t.id).select("id");
    if (u?.length) moved++;
  }
  return { ok: true, data: { moved } };
}

// --- قائمة التحقق والمهام الفرعية ---
export async function addChecklistItem(db: Db, taskId: string, text: string): Promise<Result<{ id: string }>> {
  const { data: existing } = await db.from("planner_checklist_items").select("id").eq("task_id", taskId);
  if ((existing?.length ?? 0) >= planner.tasks.checklist_max_items) return fail("checklist_full");
  const { data, error } = await db.from("planner_checklist_items").insert({ task_id: taskId, text: text.trim(), order: existing?.length ?? 0 }).select("id").single();
  if (error) return fail(error.message);
  return { ok: true, data: { id: data.id as string } };
}
export async function toggleChecklistItem(db: Db, id: string, done: boolean): Promise<Result> {
  const { data, error } = await db.from("planner_checklist_items").update({ done }).eq("id", id).select("id");
  if (error) return fail(error.message);
  return data?.length ? { ok: true, data: undefined } : fail("not_allowed");
}

// --- التذكيرات ---
export async function addReminder(db: Db, i: { taskId: string; spec: ReminderSpec; tz: string }): Promise<Result<{ id: string }>> {
  const task = await getTask(db, i.taskId);
  if (!task) return fail("not_found");
  const { data: existing } = await db.from("planner_reminders").select("id").eq("task_id", i.taskId);
  if ((existing?.length ?? 0) >= planner.reminders.max_per_task) return fail("reminders_full");
  const at = reminderFireAt(i.spec, task, i.tz);
  if (!at) return fail("task_has_no_due");
  const { data, error } = await db.from("planner_reminders").insert({ task_id: i.taskId, kind: i.spec.kind, at: at.toISOString(), offset_min: i.spec.kind === "relative" ? i.spec.offset_min : null, important: i.spec.important ?? false }).select("id").single();
  if (error) return fail(error.message);
  return { ok: true, data: { id: data.id as string } };
}

export async function snoozeReminder(db: Db, i: { reminderId: string; option: SnoozeOption; tz: string; now?: Date }): Promise<Result<{ until: string }>> {
  const until = snoozeUntil(i.option, i.now ?? new Date(), i.tz);
  const { data, error } = await db.from("planner_reminders").update({ snoozed_until: until.toISOString(), sent_at: null }).eq("id", i.reminderId).select("id");
  if (error) return fail(error.message);
  return data?.length ? { ok: true, data: { until: until.toISOString() } } : fail("not_allowed");
}

export async function listReminders(db: Db, taskId: string): Promise<PlannerReminderRow[]> {
  const { data } = await db.from("planner_reminders").select("*").eq("task_id", taskId).order("at", { ascending: true });
  return (data ?? []) as PlannerReminderRow[];
}

/**
 * الدورة المجدولة (عميل الخدمة): كل تذكير مستحق (at أو snoozed_until ≤ الآن) لمهمة مفتوحة يصبح إشعارًا من نوع planner_reminder
 * بـ payload.important؛ الحد اليومي لا يشمله (limits.notifications.user_set_types)، وساعات الهدوء تؤجله إلا إذا كان مهمًا (deliverDue).
 */
export async function firePlannerReminders(admin: Db, now = new Date()): Promise<{ fired: number }> {
  const horizon = new Date(now.getTime() + planner.reminders.tick_lookahead_min * 60000).toISOString();
  const { data } = await admin.from("planner_reminders").select("id, task_id, at, important, snoozed_until").is("sent_at", null).neq("kind", "place").lte("at", horizon);
  let fired = 0;
  for (const r of (data ?? []) as Array<{ id: string; task_id: string; at: string; important: boolean; snoozed_until: string | null }>) {
    const fireAt = r.snoozed_until && r.snoozed_until > r.at ? r.snoozed_until : r.at;
    if (fireAt > horizon) continue;
    const { data: task } = await admin.from("planner_tasks").select("id, profile_id, title, status").eq("id", r.task_id).maybeSingle();
    if (!task) continue;
    if (task.status !== "open") { await admin.from("planner_reminders").update({ sent_at: now.toISOString() }).eq("id", r.id); continue; }
    await admin.from("notifications").insert({ profile_id: task.profile_id, type: REMINDER_NOTIFICATION_TYPE, scheduled_for: now.toISOString(), dedupe_key: `planner_reminder:${r.id}:${fireAt}`, payload: { task_id: task.id, reminder_id: r.id, title: task.title, important: r.important } });
    await admin.from("planner_reminders").update({ sent_at: now.toISOString() }).eq("id", r.id);
    fired++;
  }
  return { fired };
}

// --- مستوى الأدوات ---
export type PlannerProfile = { id: string; age_mode: AgeMode; incentive_stage: number; planner_tier_max: number; timezone: string };

/** يحسب المستوى الفعّال ويثبّت الانفتاح الجديد (never_lock_after_unlock) عبر RPC آمنة. */
export async function loadPlannerTier(db: Db, profile: PlannerProfile, caps: Parameters<typeof avgSupport>[0]): Promise<TierResult & { tools: Set<string> }> {
  const override = await effective<number | null>(db, profile.id, "planner_tier_override");
  // ب.2: التجاوز للبالغ لنفسه وللمربي في child؛ طبقة المتدرب المراهق تُتجاهل
  const ov = profile.age_mode === "teen" && override.source === "player" ? null : override.value;
  const r = plannerTier({ ageMode: profile.age_mode, avgSupport: avgSupport(caps), incentiveStage: profile.incentive_stage, override: ov, maxUnlocked: profile.planner_tier_max });
  if (r.newMax > profile.planner_tier_max) await db.rpc("planner_record_tier", { p_profile_id: profile.id, p_tier: r.newMax });
  return { ...r, tools: toolsForTier(r.tier) as Set<string> };
}

export async function loadProjectsAndTags(db: Db, profileId: string): Promise<{ projects: PlannerProjectRow[]; tags: PlannerTagRow[] }> {
  const [{ data: projects }, { data: tags }] = await Promise.all([
    db.from("planner_projects").select("*").eq("profile_id", profileId).eq("archived", false).order("order", { ascending: true }),
    db.from("planner_tags").select("*").eq("profile_id", profileId).order("name", { ascending: true }),
  ]);
  return { projects: (projects ?? []) as PlannerProjectRow[], tags: (tags ?? []) as PlannerTagRow[] };
}

export async function tagsByTask(db: Db, taskIds: string[]): Promise<Map<string, string[]>> {
  if (taskIds.length === 0) return new Map();
  const { data } = await db.from("planner_task_tags").select("task_id, tag_id").in("task_id", taskIds);
  const m = new Map<string, string[]>();
  for (const r of (data ?? []) as Array<{ task_id: string; tag_id: string }>) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r.tag_id]);
  return m;
}

export type { PlannerTier };
