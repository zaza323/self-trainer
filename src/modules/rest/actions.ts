"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { effective } from "@/modules/settings";
import { startRest, endRest } from "./service";
import { startTransition } from "@/modules/followups/service";
import type { WeekStart } from "@/modules/planner/recurrence";
import type { AgeMode } from "@/shared/config";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };
async function owner() { const s = await getSession(); if (!s?.profile || s.profile.kind !== "player") return null; return { id: s.profile.id, user_id: s.userId, age_mode: s.profile.age_mode as AgeMode, timezone: s.profile.timezone }; }

/** P41 ⇒ P42: بدء راحة (كاختيار مقصود rest_chosen، لا دليل). */
export async function startRestAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ activity_key: z.string().min(1).max(40), custom_id: z.string().uuid().optional().or(z.literal("")), minutes: z.coerce.number().int().min(0).max(180), source: z.enum(["next", "free_gap", "pomodoro", "priorities_done", "wind_down", "manual"]).default("manual") })
    .safeParse({ activity_key: form.get("activity_key"), custom_id: form.get("custom_id") ?? "", minutes: form.get("minutes"), source: form.get("source") ?? "manual" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const tr = await startTransition(db, null, o, { fromFollowupId: null, nextKind: "rest", nextItemId: null, suggestedBy: "user", transitionMin: 0 });
  const r = await startRest(db, o, { activityKey: p.data.activity_key, customId: p.data.custom_id || null, plannedMin: p.data.minutes, source: p.data.source, transitionId: tr.transitionId });
  if (!r.ok) return r;
  redirect(`/app/rest/${r.id}`);
}

/** P42: «رجعت» ثم «رجعت مرتاح؟». */
export async function endRestAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ session_id: z.string().uuid(), feel: z.enum(["more", "same", "less"]).optional().or(z.literal("")) }).safeParse({ session_id: form.get("session_id"), feel: form.get("feel") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const weekStart = (await effective<WeekStart>(db, o.id, "week_start_day")).value;
  const r = await endRest(db, adminOrNull(), o, { sessionId: p.data.session_id, feel: p.data.feel || null, weekStart });
  revalidatePath("/app", "layout");
  return { ok: true, data: r };
}

export async function addCustomRestAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ title: z.string().trim().min(1).max(80), default_min: z.coerce.number().int().min(1).max(180) }).safeParse({ title: form.get("title"), default_min: form.get("default_min") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { error } = await db.from("custom_rest_activities").insert({ profile_id: o.id, title: p.data.title, default_min: p.data.default_min, created_by: o.user_id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/rest");
  return { ok: true };
}
