"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { afterTaskCompleted, afterTaskCancelled } from "./bridge-service";
import { getSession } from "@/modules/accounts";
import { effective } from "@/modules/settings";
import { todayIn } from "@/modules/missions/queries";
import { planner, PLANNER_PRIORITIES, type PlannerTool } from "@/shared/config";
import { addDays } from "./recurrence";
import type { Recurrence, WeekStart } from "./recurrence";
import { hasTool } from "./tiers";
import * as svc from "./service";
import { loadPlannerContext } from "./context";

export type PlannerActionResult = { ok: true; data?: unknown } | { ok: false; error: string };
const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };

async function owner() {
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return null;
  return { session: s, profile: s.profile };
}

async function prefs(db: Awaited<ReturnType<typeof createClient>>, profileId: string, tz: string): Promise<{ weekStart: WeekStart; today: string }> {
  const ws = await effective<WeekStart>(db, profileId, "week_start_day");
  return { weekStart: ws.value, today: todayIn(tz) };
}

const recurrenceSchema = z.union([
  z.object({ kind: z.literal("daily") }), z.object({ kind: z.literal("weekly"), byday: z.array(z.number().int().min(0).max(6)).min(1) }),
  z.object({ kind: z.literal("weekdays") }), z.object({ kind: z.literal("every_n_days"), n: z.number().int().positive() }), z.object({ kind: z.literal("monthly_day"), day: z.number().int().min(1).max(31) }),
]);
const newTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  priority: z.enum(PLANNER_PRIORITIES).default("none"),
  due_date: dateStr.nullable().default(null),
  due_time: timeStr.nullable().default(null),
  estimate_min: z.coerce.number().int().positive().nullable().default(null),
  recurrence: recurrenceSchema.nullable().default(null),
  recur_from: z.enum(["schedule", "completion"]).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  project: z.string().trim().max(80).nullable().default(null),
  project_id: uuid.nullable().default(null),
  parent_task_id: uuid.nullable().default(null),
  reminder_offset_min: z.coerce.number().int().nonnegative().nullable().default(null),
  created_via: z.enum(["manual", "nlp", "voice"]).default("manual"),
});

/** P33: حفظ ما أكده المستخدم في المعاينة (لا حفظ صامت). الأداة project/tags تحتاج المستوى 1. */
export async function createTaskAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const raw = form.get("payload");
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(String(raw ?? "{}")); } catch { return { ok: false, error: "invalid_input" }; }
  const p = newTaskSchema.safeParse(parsedJson);
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const ctx = await loadPlannerContext(db, o.profile);
  const wantsTier1 = Boolean(p.data.project || p.data.project_id || p.data.tags.length);
  if (wantsTier1 && !hasTool(ctx.tier.tier, "projects")) return { ok: false, error: "tool_locked" };
  const { weekStart } = await prefs(db, o.profile.id, o.profile.timezone);
  const r = await svc.createTask(db, {
    profileId: o.profile.id, title: p.data.title, notes: p.data.notes || null, priority: p.data.priority, due_date: p.data.due_date, due_time: p.data.due_time,
    estimate_min: p.data.estimate_min, recurrence: p.data.recurrence as Recurrence | null, recur_from: p.data.recur_from, tags: p.data.tags, project_name: p.data.project, project_id: p.data.project_id,
    parent_task_id: p.data.parent_task_id, reminders: p.data.reminder_offset_min === null ? [] : [{ kind: "relative", offset_min: p.data.reminder_offset_min }],
    created_via: p.data.created_via, created_by: o.session.userId, weekStart, tz: o.profile.timezone,
  });
  if (!r.ok) return r;
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: r.data };
}

export async function completeTaskAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ task_id: uuid, actual_min: z.coerce.number().int().nonnegative().optional().or(z.literal("")) }).safeParse({ task_id: form.get("task_id"), actual_min: form.get("actual_min") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { weekStart } = await prefs(db, o.profile.id, o.profile.timezone);
  const r = await svc.completeTask(db, { taskId: p.data.task_id, actualMin: typeof p.data.actual_min === "number" ? p.data.actual_min : null, tz: o.profile.timezone, weekStart });
  if (!r.ok) return r;
  // ب.8 + ب.11: XP بشرط التقدير/الكتلة، وأدلة P1/P3 (مرة واحدة لكل مهمة)
  const admin = adminOrNull();
  const bridge = admin ? await afterTaskCompleted(admin, o.profile, r.data.task) : null;
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: { nextTaskId: r.data.nextTaskId, xp: bridge?.xp ?? 0 } };
}

export async function reopenTaskAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const id = uuid.safeParse(form.get("task_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  if (!(await owner())) return { ok: false, error: "not_allowed" };
  const r = await svc.reopenTask(await createClient(), id.data);
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}

/** التأجيل (ب.8): اليوم / بكرا / تاريخ. يعيد prompt=true عند بلوغ الحد (مرة واحدة). */
export async function postponeTaskAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ task_id: uuid, to: z.union([z.literal("today"), z.literal("tomorrow"), dateStr]) }).safeParse({ task_id: form.get("task_id"), to: form.get("to") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const today = todayIn(o.profile.timezone);
  const newDate = p.data.to === "today" ? today : p.data.to === "tomorrow" ? addDays(today, 1) : p.data.to;
  const r = await svc.postponeTask(db, { taskId: p.data.task_id, newDate });
  if (!r.ok) return r;
  if (r.data.prompt) await svc.markPostponePrompted(db, p.data.task_id);
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: r.data };
}

/** ردّ سؤال التأجيل: كل خيار يقود لفعل. «غير ذلك» يُحفظ في الملاحظات. */
export async function postponeAnswerAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ task_id: uuid, choice: z.enum(["too_big", "unclear", "not_important", "no_time", "other"]), text: z.string().trim().max(300).optional().or(z.literal("")) }).safeParse({ task_id: form.get("task_id"), choice: form.get("choice"), text: form.get("text") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  if (p.data.choice === "not_important") {
    const r = await svc.cancelTask(db, { taskId: p.data.task_id, reason: p.data.text || null }); if (!r.ok) return r;
    const t = await svc.getTask(db, p.data.task_id); const admin = adminOrNull(); if (t && admin) await afterTaskCancelled(admin, o.profile, t);
  }
  else if (p.data.choice === "other" && p.data.text) {
    const t = await svc.getTask(db, p.data.task_id);
    await svc.updateTask(db, p.data.task_id, { notes: [t?.notes, p.data.text].filter(Boolean).join("\n") });
  }
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: { next: p.data.choice } };
}

export async function cancelTaskAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ task_id: uuid, reason: z.string().trim().max(300).optional().or(z.literal("")) }).safeParse({ task_id: form.get("task_id"), reason: form.get("reason") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const r = await svc.cancelTask(db, { taskId: p.data.task_id, reason: p.data.reason || null });
  if (!r.ok) return r;
  // P5: إلغاء واعٍ مع سبب مكتوب
  const t = await svc.getTask(db, p.data.task_id); const admin = adminOrNull(); if (t && admin) await afterTaskCancelled(admin, o.profile, t);
  revalidatePath("/app/planner", "layout");
  return r;
}

export async function moveOverdueAction(): Promise<PlannerActionResult> {
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const r = await svc.moveOverdueToToday(await createClient(), o.profile.id, todayIn(o.profile.timezone));
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}

export async function updateTaskAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({
    task_id: uuid, title: z.string().trim().min(1).max(200), notes: z.string().trim().max(2000).optional().or(z.literal("")), priority: z.enum(PLANNER_PRIORITIES),
    due_date: dateStr.optional().or(z.literal("")), due_time: timeStr.optional().or(z.literal("")), estimate_min: z.coerce.number().int().positive().optional().or(z.literal("")),
    project_id: uuid.optional().or(z.literal("")), section_id: uuid.optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(["task_id", "title", "notes", "priority", "due_date", "due_time", "estimate_min", "project_id", "section_id"].map((k) => [k, form.get(k) ?? ""])));
  if (!p.success) return { ok: false, error: "invalid_input" };
  if (!(await owner())) return { ok: false, error: "not_allowed" };
  const d = p.data;
  const r = await svc.updateTask(await createClient(), d.task_id, { title: d.title, notes: d.notes || null, priority: d.priority, due_date: d.due_date || null, due_time: d.due_time || null, estimate_min: typeof d.estimate_min === "number" ? d.estimate_min : null, project_id: d.project_id || null, section_id: d.section_id || null });
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}

export async function addChecklistAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ task_id: uuid, text: z.string().trim().min(1).max(200) }).safeParse({ task_id: form.get("task_id"), text: form.get("text") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  if (!(await owner())) return { ok: false, error: "not_allowed" };
  const r = await svc.addChecklistItem(await createClient(), p.data.task_id, p.data.text);
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}
export async function toggleChecklistAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ id: uuid, done: z.enum(["true", "false"]) }).safeParse({ id: form.get("id"), done: form.get("done") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  if (!(await owner())) return { ok: false, error: "not_allowed" };
  const r = await svc.toggleChecklistItem(await createClient(), p.data.id, p.data.done === "true");
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}

export async function addReminderAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ task_id: uuid, kind: z.enum(["absolute", "relative"]), at: z.string().optional().or(z.literal("")), offset_min: z.coerce.number().int().nonnegative().optional().or(z.literal("")), important: z.string().optional() })
    .safeParse({ task_id: form.get("task_id"), kind: form.get("kind"), at: form.get("at") ?? "", offset_min: form.get("offset_min") ?? "", important: form.get("important") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const important = p.data.important === "on";
  const spec = p.data.kind === "absolute"
    ? { kind: "absolute" as const, at: new Date(String(p.data.at)).toISOString(), important }
    : { kind: "relative" as const, offset_min: typeof p.data.offset_min === "number" ? p.data.offset_min : 0, important };
  if (spec.kind === "absolute" && Number.isNaN(new Date(String(p.data.at)).getTime())) return { ok: false, error: "invalid_input" };
  const r = await svc.addReminder(await createClient(), { taskId: p.data.task_id, spec, tz: o.profile.timezone });
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}

export async function snoozeReminderAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ reminder_id: uuid, option: z.coerce.number().int().min(0) }).safeParse({ reminder_id: form.get("reminder_id"), option: form.get("option") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const option = planner.reminders.snooze_options[p.data.option];
  if (!option) return { ok: false, error: "invalid_input" };
  const r = await svc.snoozeReminder(await createClient(), { reminderId: p.data.reminder_id, option, tz: o.profile.timezone });
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}

// --- المشاريع والأقسام والوسوم والفلاتر (المستوى 1) ---
async function tier1(tool: PlannerTool = "projects") {
  const o = await owner();
  if (!o) return null;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, o.profile);
  if (!hasTool(ctx.tier.tier, tool)) return null;
  return { o, db };
}
export async function createProjectAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ name: z.string().trim().min(1).max(80), context_tag: z.string().trim().max(40).optional().or(z.literal("")) }).safeParse({ name: form.get("name"), context_tag: form.get("context_tag") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const t = await tier1();
  if (!t) return { ok: false, error: "tool_locked" };
  const { error } = await t.db.from("planner_projects").insert({ profile_id: t.o.profile.id, name: p.data.name, context_tag: p.data.context_tag || null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}
export async function createSectionAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ project_id: uuid, name: z.string().trim().min(1).max(80) }).safeParse({ project_id: form.get("project_id"), name: form.get("name") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const t = await tier1("sections");
  if (!t) return { ok: false, error: "tool_locked" };
  const { error } = await t.db.from("planner_sections").insert({ project_id: p.data.project_id, name: p.data.name });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}
export async function archiveProjectAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const id = uuid.safeParse(form.get("project_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const t = await tier1();
  if (!t) return { ok: false, error: "tool_locked" };
  await t.db.from("planner_projects").update({ archived: true }).eq("id", id.data);
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}
export async function createTagAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ name: z.string().trim().min(1).max(40) }).safeParse({ name: form.get("name") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const t = await tier1("tags");
  if (!t) return { ok: false, error: "tool_locked" };
  const { error } = await t.db.from("planner_tags").insert({ profile_id: t.o.profile.id, name: p.data.name });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}
export async function deleteTagAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const id = uuid.safeParse(form.get("tag_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const t = await tier1("tags");
  if (!t) return { ok: false, error: "tool_locked" };
  await t.db.from("planner_tags").delete().eq("id", id.data);
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}
export async function saveFilterAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const p = z.object({ name: z.string().trim().min(1).max(60), priority: z.array(z.enum(PLANNER_PRIORITIES)).default([]), status: z.array(z.enum(["open", "done", "cancelled"])).default([]), from: dateStr.optional().or(z.literal("")), to: dateStr.optional().or(z.literal("")), project_id: uuid.optional().or(z.literal("")), tag_ids: z.array(uuid).default([]) })
    .safeParse({ name: form.get("name"), priority: form.getAll("priority"), status: form.getAll("status"), from: form.get("from") ?? "", to: form.get("to") ?? "", project_id: form.get("project_id") ?? "", tag_ids: form.getAll("tag_ids") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const t = await tier1("saved_filters");
  if (!t) return { ok: false, error: "tool_locked" };
  const q = { priority: p.data.priority, status: p.data.status, from: p.data.from || null, to: p.data.to || null, project_id: p.data.project_id || null, tag_ids: p.data.tag_ids };
  const { error } = await t.db.from("planner_saved_filters").insert({ profile_id: t.o.profile.id, name: p.data.name, query: q });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}
export async function deleteFilterAction(_: unknown, form: FormData): Promise<PlannerActionResult> {
  const id = uuid.safeParse(form.get("filter_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const t = await tier1("saved_filters");
  if (!t) return { ok: false, error: "tool_locked" };
  await t.db.from("planner_saved_filters").delete().eq("id", id.data);
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}
