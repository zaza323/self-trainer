"use server";
/** أفعال المرحلة 11: ذكاء المخطط (ب.10) والجسر إلى التدريب (ب.11). كل اقتراح معاينة؛ الحفظ بفعل منفصل من المستخدم. */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { aiEnabled, anthropicCaller, classifyTask } from "@/modules/companion";
import { instantForLocal, localParts } from "@/modules/notifications/plan";
import type { AgeMode } from "@/shared/config";
import { loadPlannerContext } from "./context";
import { hasTool } from "./tiers";
import * as svc from "./service";
import { parseQuickAdd, needsAiFallback } from "./nlp";
import { taskBreakdown, dayPlanner, taskParserFallback } from "./ai";
import { afterUserBreakdown, convertTaskToMission, planningLevel } from "./bridge-service";
import { createBlock, blocksBetween } from "./blocks-service";
import { toMin } from "./day-plan";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const uuid = z.string().uuid();
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };

async function owner() {
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player" || !s.profile.age_mode) return null;
  const p = { id: s.profile.id, age_mode: s.profile.age_mode as AgeMode, timezone: s.profile.timezone };
  return { session: s, row: s.profile, p };
}
const jsonArr = <T extends z.ZodTypeAny>(item: T) => z.string().transform((s, c) => { try { return JSON.parse(s) as unknown; } catch { c.addIssue({ code: "custom", message: "json" }); return z.NEVER; } }).pipe(z.array(item));

/** P33: «ساعدني أفهمها» — فقط حين ثقة المحلّل الحتمي أقل من الحد. النتيجة معاينة، لا حفظ. */
export async function aiParseAction(_: unknown, form: FormData): Promise<Res> {
  const text = z.string().trim().min(1).max(300).safeParse(form.get("text"));
  if (!text.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const ctx = await loadPlannerContext(db, o.row);
  const pctx = { today: ctx.today, ambiguousPmUntil: ctx.ambiguousPmUntil, weekStart: ctx.weekStart };
  const det = parseQuickAdd(text.data, pctx);
  const admin = adminOrNull();
  if (!needsAiFallback(det) || !admin || !aiEnabled()) return { ok: true, data: { parsed: det, source: "deterministic" } };
  const r = await taskParserFallback({ db: admin, caller: anthropicCaller(), profileId: o.p.id, mode: o.p.age_mode, text: text.data, ctx: pctx, deterministic: det });
  return { ok: true, data: r };
}

/** ب.10 task_breakdown: عند L2+ يسأل أولًا ولا يقترح قبل خطوة المستخدم. */
export async function breakdownAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ task_id: uuid, user_steps: z.array(z.string().trim().max(120)).max(10) }).safeParse({ task_id: form.get("task_id"), user_steps: form.getAll("user_step").map(String) });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const task = await svc.getTask(db, p.data.task_id); if (!task) return { ok: false, error: "not_found" };
  const admin = adminOrNull(); if (!admin) return { ok: false, error: "unavailable" };
  const level = await planningLevel(admin, o.p);
  const caller = anthropicCaller();
  const r = await taskBreakdown({ db: admin, caller, profileId: o.p.id, mode: o.p.age_mode, level, task: { title: task.title, notes: task.notes }, userSteps: p.data.user_steps });
  return { ok: true, data: r };
}

/** حفظ الخطوات كمهام فرعية. source لكل خطوة: user | ai. P4 عند L2+ إن كانت كلها من المستخدم. */
export async function saveBreakdownAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ task_id: uuid, steps: jsonArr(z.object({ title: z.string().trim().min(1).max(120), source: z.enum(["user", "ai"]), estimate_min: z.number().int().positive().nullable().optional() })).pipe(z.array(z.any()).min(1).max(10)) })
    .safeParse({ task_id: form.get("task_id"), steps: form.get("steps") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const ctx = await loadPlannerContext(db, o.row);
  if (!hasTool(ctx.tier.tier, "subtasks")) return { ok: false, error: "tool_locked" };
  const parent = await svc.getTask(db, p.data.task_id); if (!parent) return { ok: false, error: "not_found" };
  const steps = p.data.steps as Array<{ title: string; source: "user" | "ai"; estimate_min?: number | null }>;
  for (const s of steps) {
    const r = await svc.createTask(db, { profileId: o.p.id, title: s.title, notes: null, priority: "none", due_date: parent.due_date, due_time: null, estimate_min: s.estimate_min ?? null, recurrence: null, recur_from: null, tags: [], project_name: null, project_id: parent.project_id, parent_task_id: parent.id, reminders: [], created_via: "manual", created_by: o.session.userId, weekStart: ctx.weekStart, tz: o.p.timezone });
    if (!r.ok) return r;
  }
  const admin = adminOrNull();
  const p4 = admin ? await afterUserBreakdown(admin, o.p, parent, { userSteps: steps.filter((s) => s.source === "user").length, usedAi: steps.some((s) => s.source === "ai") }) : false;
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: { saved: steps.length, p4 } };
}

/** ب.10 day_planner: L0–L1 ترتيب كامل، L2–L3 picks (1–3) ثم الأماكن. معاينة فقط. */
export async function dayPlanAction(_: unknown, form: FormData): Promise<Res> {
  const picks = z.array(uuid).max(10).safeParse(form.getAll("pick").map(String));
  if (!picks.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const ctx = await loadPlannerContext(db, o.row);
  const now = new Date();
  const tasks = (await svc.listTasks(db, o.p.id)).filter((t) => t.status === "open" && !t.parent_task_id && (t.due_date === null || t.due_date <= ctx.today));
  const dayStart = instantForLocal(ctx.today, "00:00", o.p.timezone).toISOString(), dayEnd = instantForLocal(ctx.today, "23:59", o.p.timezone).toISOString();
  const busy = (await blocksBetween(db, o.p.id, dayStart, dayEnd)).map((b) => ({ start: toMin(localParts(new Date(b.starts_at), o.p.timezone).hhmm), end: toMin(localParts(new Date(b.ends_at), o.p.timezone).hhmm) }));
  const admin = adminOrNull(); if (!admin) return { ok: false, error: "unavailable" };
  const level = await planningLevel(admin, o.p);
  const r = await dayPlanner({ db: admin, caller: anthropicCaller(), profileId: o.p.id, mode: o.p.age_mode, level, tasks: tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, due_date: t.due_date, due_time: t.due_time, estimate_min: t.estimate_min })), picks: picks.data, today: ctx.today, nowMin: localParts(now, o.p.timezone).minutes, busy });
  return { ok: true, data: r };
}

/** اعتماد الترتيب بعد المعاينة: كتل زمنية إن انفتحت Time Blocking، وإلا وقت المهمة اليوم. */
export async function applyDayPlanAction(_: unknown, form: FormData): Promise<Res> {
  const p = jsonArr(z.object({ task_id: uuid, start: hm, end: hm })).safeParse(form.get("placements"));
  if (!p.success || !p.data.length) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const ctx = await loadPlannerContext(db, o.row);
  const blocks = hasTool(ctx.tier.tier, "time_blocking");
  for (const pl of p.data) {
    if (blocks) { const r = await createBlock(db, { profileId: o.p.id, taskId: pl.task_id, startsAt: instantForLocal(ctx.today, pl.start, o.p.timezone).toISOString(), endsAt: instantForLocal(ctx.today, pl.end, o.p.timezone).toISOString() }); if (!r.ok) return r; }
    else { const r = await svc.updateTask(db, pl.task_id, { due_date: ctx.today, due_time: pl.start }); if (!r.ok) return r; }
  }
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: { applied: p.data.length, as: blocks ? "blocks" : "times" } };
}

/** ب.11: «تدرّب على هذه المهمة الحقيقية». الميكانيكية من task_classifier إن توفر، وإلا الافتراضية من config. */
export async function convertToMissionAction(_: unknown, form: FormData): Promise<Res> {
  const id = uuid.safeParse(form.get("task_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const task = await svc.getTask(db, id.data); if (!task) return { ok: false, error: "not_found" };
  const admin = adminOrNull(); if (!admin) return { ok: false, error: "unavailable" };
  let mechanic: string | null = null, weights: Record<string, number> | undefined, prompts: string[] | undefined;
  if (aiEnabled()) {
    const { data: goals } = await db.from("goals").select("id, title").eq("profile_id", o.p.id).eq("status", "active");
    const c = await classifyTask({ db: admin, caller: anthropicCaller(), profileId: o.p.id, mode: o.p.age_mode, text: `${task.title}\n${task.notes ?? ""}`, goals: (goals ?? []) as Array<{ id: string; title: string }> });
    if (c) { mechanic = c.mechanic; weights = c.capability_weights as Record<string, number>; prompts = c.reflection_prompts; }
  }
  const r = await convertTaskToMission(admin, o.p, task, { createdBy: o.session.userId, mechanic, weights, prompts });
  if (!r.ok) return r;
  revalidatePath("/app", "layout");
  return { ok: true, data: { missionId: r.missionId } };
}

/** G14 (ب.12): مربٍ بصلاحية add_missions يضيف مهمة لمخطط الطفل (created_via = guardian). RLS تفرض الصلاحية. */
export async function guardianAddTaskAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ profile_id: uuid, title: z.string().trim().min(1).max(200), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")), priority: z.enum(["high", "medium", "low", "none"]).default("none") })
    .safeParse({ profile_id: form.get("profile_id"), title: form.get("title"), due_date: form.get("due_date") ?? "", priority: form.get("priority") || "none" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { error } = await db.from("planner_tasks").insert({ profile_id: p.data.profile_id, title: p.data.title, due_date: p.data.due_date || null, priority: p.data.priority, created_via: "guardian", created_by: s.userId });
  if (error) return { ok: false, error: /row-level security|not allowed/i.test(error.message) ? "not_allowed" : error.message };
  revalidatePath(`/guardian/${p.data.profile_id}/planner`);
  return { ok: true };
}
