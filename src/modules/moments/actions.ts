"use server";
import { paceConfig } from "@/modules/pace/rules";
import { aiEnabled, anthropicCaller } from "@/modules/companion";
import { evidenceFromFreeText } from "@/modules/planner/reflection-evidence";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { todayIn } from "@/modules/missions/queries";
import { dismissMoment, answerMoment } from "./service";
import { MOMENT_KEYS } from "./openers";
import type { AgeMode } from "@/shared/config";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };
async function owner() { const s = await getSession(); if (!s?.profile || s.profile.kind !== "player") return null; return { s, p: { id: s.profile.id, user_id: s.userId, age_mode: s.profile.age_mode as AgeMode, timezone: s.profile.timezone, display_name: s.profile.display_name } }; }

/** «مش هلق» (ج.5). */
export async function dismissMomentAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ moment: z.enum(MOMENT_KEYS) }).safeParse({ moment: form.get("moment") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  await dismissMoment(await createClient(), o.p.id, todayIn(o.p.timezone), p.data.moment);
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** P36/P37: الإجابة — أولويات (مهام أو نص) أو تأكيد أو تأمل مسائي. */
export async function answerMomentAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ moment: z.enum(MOMENT_KEYS), task_ids: z.array(z.string().uuid()).max(3).default([]), texts: z.array(z.string().trim().max(200)).default([]), free: z.string().trim().max(1500).optional().or(z.literal("")), confirm: z.enum(["yes", "change"]).optional() })
    .safeParse({ moment: form.get("moment"), task_ids: form.getAll("task_ids"), texts: form.getAll("texts"), free: form.get("free") ?? "", confirm: form.get("confirm") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const today = todayIn(o.p.timezone);
  const { data: tasks } = p.data.task_ids.length ? await db.from("planner_tasks").select("id, title").in("id", p.data.task_ids) : { data: [] };
  const titles = new Map(((tasks ?? []) as Array<{ id: string; title: string }>).map((t) => [t.id, t.title]));
  let priorities = [...p.data.task_ids.map((id) => ({ task_id: id, text: titles.get(id) ?? "" })), ...p.data.texts.filter(Boolean).map((text) => ({ task_id: null, text }))].slice(0, paceConfig.morning_priorities_from_pace.max);
  if (p.data.confirm === "yes" && priorities.length === 0) {
    const { data: y } = await db.from("daily_checkins").select("top_priorities").eq("profile_id", o.p.id).in("moment", ["night_plan", "muhasaba"]).eq("status", "answered").order("local_date", { ascending: false }).limit(1);
    priorities = ((y ?? [])[0]?.top_priorities as typeof priorities | undefined) ?? [];
  }
  if (p.data.confirm === "change") { await dismissMoment(db, o.p.id, today, p.data.moment); await db.from("daily_checkins").update({ status: "shown" }).eq("profile_id", o.p.id).eq("local_date", today).eq("moment", p.data.moment); return { ok: true, data: { change: true } }; }
  const admin = adminOrNull();
  const r = await answerMoment(db, admin, o.p, { date: today, moment: p.data.moment, priorities, text: p.data.free || null, confirm: p.data.confirm === "yes" });
  // D2: التأمل المسائي المكتوب ⇒ reflection_quality عبر مرشح reflection_coach (مصدر ai)
  if (r.ok && admin && aiEnabled() && p.data.moment === "evening_review" && p.data.free) await evidenceFromFreeText(admin, anthropicCaller(), o.p, { ruleId: "D2", capability: "self_awareness", text: p.data.free, dedupeKey: `${o.p.id}:${today}`, context: "التأمل المسائي: شو مشي وشو ما مشي اليوم؟" });
  revalidatePath("/app", "layout");
  return r.ok ? { ok: true, data: { xp: r.xp } } : { ok: false, error: "save_failed" };
}
