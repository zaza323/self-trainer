"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { trial } from "@/shared/config";
import { activeCohort, snapshotCohort } from "./service";
import { track } from "./analytics";
import content from "@content/trial.ar.json";

export type TrialActionResult = { ok: true; data?: unknown } | { ok: false; error: string };
const mapErr = (m: string) => (Object.keys(content.admin.errors).find((k) => m.includes(k)) ?? (/not allowed/.test(m) ? "not_allowed" : m));

/** A08: بدء دفعة التجربة المغلقة (حدودها من config/trial.json). */
export async function createCohort(_: unknown, form: FormData): Promise<TrialActionResult> {
  const name = String(form.get("name") ?? "").trim() || `cohort-${new Date().toISOString().slice(0, 10)}`;
  const s = await getSession();
  if (!s?.isAdmin) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { error } = await db.rpc("create_trial_cohort", { p_name: name, p_weeks: trial.cohort.weeks, p_modes: trial.cohort.enabled_age_modes, p_max: trial.cohort.max_users });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/admin/trial");
  return { ok: true };
}

export async function enrollParticipant(_: unknown, form: FormData): Promise<TrialActionResult> {
  const p = z.object({ cohort_id: z.string().uuid(), profile_id: z.string().uuid() }).safeParse({ cohort_id: form.get("cohort_id"), profile_id: form.get("profile_id") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.isAdmin) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { error } = await db.rpc("enroll_trial_participant", { p_cohort: p.data.cohort_id, p_profile: p.data.profile_id });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/admin/trial");
  return { ok: true };
}

export async function computeNow(): Promise<TrialActionResult> {
  const s = await getSession();
  if (!s?.isAdmin) return { ok: false, error: "not_allowed" };
  const admin = createAdminClient();
  const c = await activeCohort(admin);
  if (!c) return { ok: false, error: "no_cohort" };
  await snapshotCohort(admin, c);
  revalidatePath("/admin/trial");
  return { ok: true };
}

/** 8.4 / الحالات الحدية: حذف الحساب — المالك (teen/adult) أو المربي المنشئ للطفل. يحذف مستخدم auth بعد الملف. */
export async function deleteAccount(_: unknown, form: FormData): Promise<TrialActionResult> {
  const p = z.object({ profile_id: z.string().uuid(), confirm: z.string() }).safeParse({ profile_id: form.get("profile_id"), confirm: form.get("confirm") ?? "" });
  if (!p.success || p.data.confirm.trim() !== content.data.delete_word) return { ok: false, error: "confirm_required" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data: userId, error } = await db.rpc("delete_player_account", { p_profile: p.data.profile_id });
  if (error) return { ok: false, error: /not allowed/.test(error.message) ? "not_allowed" : error.message };
  const admin = createAdminClient();
  await track(admin, { event: "account_deleted" });
  try { await admin.auth.admin.deleteUser(userId as string); } catch { /* لا auth admin محليًا */ }
  if (userId === s.userId) { await db.auth.signOut(); redirect("/login"); }
  revalidatePath("/guardian", "layout");
  return { ok: true };
}
