"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { effective } from "@/modules/settings";
import { todayIn } from "@/modules/missions/queries";
import { PLANNER_TOOLS, type PlannerTool } from "@/shared/config";
import { hasTool } from "./tiers";
import { loadPlannerContext } from "./context";
import type { WeekStart } from "./recurrence";
import { createHabit, checkinHabit } from "./habits-service";
import { startFocus, endFocus, recordDistraction, focusSessionsOn } from "./focus-service";
import { afterDistraction } from "./bridge-service";
import { createBlock, deleteBlock } from "./blocks-service";
import { getOrCreateReview, saveReviewStep } from "./review-service";
import { updateTask } from "./service";
import { instantForLocal } from "@/modules/notifications/plan";
import { addDays } from "./recurrence";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const uuid = z.string().uuid();
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };

async function ctxFor(tool: PlannerTool) {
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return null;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile);
  if (!hasTool(ctx.tier.tier, tool)) return null;
  return { s, db, ctx, profile: s.profile };
}

// --- العادات (المستوى 1) ---
export async function createHabitAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ title: z.string().trim().min(1).max(120), kind: z.enum(["daily", "weekdays_set", "times_per_week"]), days: z.array(z.coerce.number().int().min(0).max(6)).default([]), times: z.coerce.number().int().min(1).max(7).optional(), time_local: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")), duration_min: z.coerce.number().int().positive().optional().or(z.literal("")), capability_id: z.string().optional().or(z.literal("")) })
    .safeParse({ title: form.get("title"), kind: form.get("kind"), days: form.getAll("days"), times: form.get("times") || undefined, time_local: form.get("time_local") ?? "", duration_min: form.get("duration_min") ?? "", capability_id: form.get("capability_id") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("habits");
  if (!c) return { ok: false, error: "tool_locked" };
  const d = p.data;
  const extra = { time_local: d.time_local || null, duration_min: typeof d.duration_min === "number" ? d.duration_min : null };
  const schedule = d.kind === "daily" ? { kind: "daily" as const, ...extra } : d.kind === "weekdays_set" ? { kind: "weekdays_set" as const, days: d.days, ...extra } : { kind: "times_per_week" as const, times: d.times ?? 3, ...extra };
  const r = await createHabit(c.db, { profileId: c.profile.id, title: d.title, schedule, capabilityId: d.capability_id || null });
  if (!r.ok) return r;
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: { id: r.id } };
}
export async function checkinHabitAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ habit_id: uuid, done: z.enum(["true", "false"]).default("true") }).safeParse({ habit_id: form.get("habit_id"), done: form.get("done") ?? "true" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("habits");
  if (!c) return { ok: false, error: "tool_locked" };
  const r = await checkinHabit(c.db, adminOrNull(), { habitId: p.data.habit_id, profileId: c.profile.id, date: c.ctx.today, done: p.data.done === "true", weekStart: c.ctx.weekStart });
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: r };
}
export async function archiveHabitAction(_: unknown, form: FormData): Promise<Res> {
  const id = uuid.safeParse(form.get("habit_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("habits");
  if (!c) return { ok: false, error: "tool_locked" };
  await c.db.from("planner_habits").update({ archived: true }).eq("id", id.data);
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}

// --- التركيز (المستوى 1) ---
export async function startFocusAction(_: unknown, form: FormData): Promise<Res> {
  const taskId = form.get("task_id") ? uuid.safeParse(form.get("task_id")) : null;
  const c = await ctxFor("pomodoro");
  if (!c) return { ok: false, error: "tool_locked" };
  const r = await startFocus(c.db, { profileId: c.profile.id, taskId: taskId?.success ? taskId.data : null });
  if (!r.ok) return r;
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: { id: r.id } };
}
export async function endFocusAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ session_id: uuid, completed: z.enum(["true", "false"]) }).safeParse({ session_id: form.get("session_id"), completed: form.get("completed") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("pomodoro");
  if (!c) return { ok: false, error: "tool_locked" };
  const dayStart = instantForLocal(c.ctx.today, "00:00", c.ctx.tz).toISOString(), dayEnd = instantForLocal(addDays(c.ctx.today, 1), "00:00", c.ctx.tz).toISOString();
  const sessionsToday = (await focusSessionsOn(c.db, c.profile.id, dayStart, dayEnd)).filter((s) => s.completed).length + 1;
  const shortBreak = (await effective<number>(c.db, c.profile.id, "pomodoro_break_min")).value;
  const r = await endFocus(c.db, adminOrNull(), { sessionId: p.data.session_id, completed: p.data.completed === "true", sessionNumberToday: sessionsToday, shortBreakMin: shortBreak });
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: r };
}
export async function focusDistractionAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ session_id: uuid, returned: z.enum(["null", "true", "false"]) }).safeParse({ session_id: form.get("session_id"), returned: form.get("returned") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("focus_mode");
  if (!c) return { ok: false, error: "tool_locked" };
  const returned = p.data.returned === "null" ? null : p.data.returned === "true";
  await recordDistraction(c.db, p.data.session_id, returned);
  // P2: الجواب على «رجعت؟» فقط يولّد دليلًا (مصدر self)
  const admin = adminOrNull();
  if (admin && returned !== null) {
    const { data: fs } = await c.db.from("planner_focus_sessions").select("task_id, distraction_count").eq("id", p.data.session_id).maybeSingle();
    if (fs) await afterDistraction(admin, c.profile, { sessionId: p.data.session_id, taskId: (fs.task_id as string | null) ?? null, returned, distractionNo: Number(fs.distraction_count) || 1 });
  }
  return { ok: true };
}

// --- الكتل الزمنية (المستوى 2) ---
export async function createBlockAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ task_id: uuid.optional().or(z.literal("")), starts_at: z.string().min(10), ends_at: z.string().min(10) }).safeParse({ task_id: form.get("task_id") ?? "", starts_at: form.get("starts_at"), ends_at: form.get("ends_at") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("time_blocking");
  if (!c) return { ok: false, error: "tool_locked" };
  const toIso = (local: string) => { const [d, t] = local.split("T"); return instantForLocal(d!, (t ?? "00:00").slice(0, 5), c.ctx.tz).toISOString(); };
  const r = await createBlock(c.db, { profileId: c.profile.id, taskId: p.data.task_id || null, startsAt: toIso(p.data.starts_at), endsAt: toIso(p.data.ends_at) });
  if (!r.ok) return r;
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: { id: r.id, conflicts: r.conflicts } };
}
export async function deleteBlockAction(_: unknown, form: FormData): Promise<Res> {
  const id = uuid.safeParse(form.get("block_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("time_blocking");
  if (!c) return { ok: false, error: "tool_locked" };
  await deleteBlock(c.db, id.data);
  revalidatePath("/app/planner", "layout");
  return { ok: true };
}

// --- Kanban وأيزنهاور (المستوى 2) ---
export async function setKanbanColumnAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ task_id: uuid, column: z.string().max(60) }).safeParse({ task_id: form.get("task_id"), column: form.get("column") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("kanban");
  if (!c) return { ok: false, error: "tool_locked" };
  const r = await updateTask(c.db, p.data.task_id, { kanban_column: p.data.column || null });
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}
export async function setQuadrantAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ task_id: uuid, important: z.enum(["true", "false"]), urgent: z.enum(["true", "false"]) }).safeParse({ task_id: form.get("task_id"), important: form.get("important"), urgent: form.get("urgent") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const c = await ctxFor("eisenhower");
  if (!c) return { ok: false, error: "tool_locked" };
  const r = await updateTask(c.db, p.data.task_id, { important: p.data.important === "true", urgent: p.data.urgent === "true" });
  if (r.ok) revalidatePath("/app/planner", "layout");
  return r;
}

// --- المراجعة الأسبوعية (المستوى 1 — stats/habits tier؛ نعتبرها متاحة للجميع كجلسة مرافق) ---
export async function weeklyReviewStepAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ step: z.enum(["done", "postponed", "next"]), text: z.string().trim().max(2000).optional().or(z.literal("")), p1: z.string().trim().max(200).optional().or(z.literal("")), p2: z.string().trim().max(200).optional().or(z.literal("")), p3: z.string().trim().max(200).optional().or(z.literal("")) })
    .safeParse({ step: form.get("step"), text: form.get("text") ?? "", p1: form.get("p1") ?? "", p2: form.get("p2") ?? "", p3: form.get("p3") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const weekStart = (await effective<WeekStart>(db, s.profile.id, "week_start_day")).value;
  const review = await getOrCreateReview(db, s.profile.id, todayIn(s.profile.timezone), weekStart);
  const priorities = [p.data.p1, p.data.p2, p.data.p3].filter((x): x is string => Boolean(x)).map((text) => ({ text, task_id: null }));
  const r = await saveReviewStep(db, adminOrNull(), { reviewId: review.id, profileId: s.profile.id, step: p.data.step, text: p.data.text || "", priorities, tz: s.profile.timezone, weekStart });
  revalidatePath("/app/planner", "layout");
  return { ok: true, data: r };
}
export const PLANNER_TOOL_LIST = PLANNER_TOOLS;
