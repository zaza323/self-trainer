"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { effective } from "@/modules/settings";
import { answerFollowup, startTransition, followupSettings } from "./service";
import type { WeekStart } from "@/modules/planner/recurrence";
import type { AgeMode } from "@/shared/config";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const uuid = z.string().uuid();
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };
async function owner() { const s = await getSession(); if (!s?.profile || s.profile.kind !== "player") return null; return { id: s.profile.id, age_mode: s.profile.age_mode as AgeMode, timezone: s.profile.timezone }; }

/** P38: رد «تمّت؟» (مفرد أو من القائمة). */
export async function answerFollowupAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ ids: z.array(uuid).min(1), reply: z.enum(["done", "partial", "missed", "postponed", "snoozed"]), postpone_to: z.string().max(12).optional().or(z.literal("")), duration_feel: z.enum(["less", "about", "more"]).optional().or(z.literal("")) })
    .safeParse({ ids: form.getAll("followup_id"), reply: form.get("reply"), postpone_to: form.get("postpone_to") ?? "", duration_feel: form.get("duration_feel") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const weekStart = (await effective<WeekStart>(db, o.id, "week_start_day")).value;
  let xp = 0;
  for (const id of p.data.ids) { const r = await answerFollowup(db, adminOrNull(), o, { followupId: id, reply: p.data.reply, postponeTo: p.data.postpone_to || null, durationFeel: p.data.duration_feel || null, weekStart }); if (!r.ok) return { ok: false, error: r.error ?? "failed" }; xp += r.xp; }
  revalidatePath("/app", "layout");
  return { ok: true, data: { xp } };
}

/** P39: بدء التالي (بقرار المستخدم أو باقتراح التطبيق). */
export async function startNextAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ next_kind: z.enum(["task", "block", "habit", "mission", "rest"]), next_item_id: uuid.optional().or(z.literal("")), suggested_by: z.enum(["app", "user"]), from_followup_id: uuid.optional().or(z.literal("")) })
    .safeParse({ next_kind: form.get("next_kind"), next_item_id: form.get("next_item_id") ?? "", suggested_by: form.get("suggested_by") ?? "app", from_followup_id: form.get("from_followup_id") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const s = await followupSettings(db, o.id);
  const r = await startTransition(db, adminOrNull(), o, { fromFollowupId: p.data.from_followup_id || null, nextKind: p.data.next_kind, nextItemId: p.data.next_item_id || null, suggestedBy: p.data.suggested_by, transitionMin: s.transitionMin });
  revalidatePath("/app", "layout");
  return { ok: true, data: r };
}
