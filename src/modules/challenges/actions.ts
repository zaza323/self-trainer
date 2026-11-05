"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { autoMatch, recomputeChallengeScores } from "./service";
import type { AgeMode } from "@/shared/config";

export type ChallengeActionResult = { ok: true; data?: unknown } | { ok: false; error: string };
const KNOWN = ["not_found", "age_mode", "training_level", "support_gap", "full", "window_closed", "disabled", "intensity", "already", "child_invite_only", "no_state"];
const mapErr = (msg: string) => KNOWN.find((k) => msg.includes(k)) ?? (/not allowed|row-level/.test(msg) ? "not_allowed" : msg);

/** P21: إنشاء تحدٍّ على قالب (teen/adult). */
export async function createChallenge(_: unknown, form: FormData): Promise<ChallengeActionResult> {
  const p = z.object({ template_id: z.string().min(1), version: z.coerce.number().int().positive() }).safeParse({ template_id: form.get("template_id"), version: form.get("version") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data, error } = await db.rpc("create_challenge", { p_profile_id: s.profile.id, p_template_id: p.data.template_id, p_version: p.data.version });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app/challenges");
  redirect(`/app/challenges/${data as string}`);
}

/** P21: الانضمام برمز دعوة. child → معلق حتى موافقة المربي. */
export async function joinByCode(_: unknown, form: FormData): Promise<ChallengeActionResult> {
  const code = String(form.get("code") ?? "").trim();
  if (!code) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data, error } = await db.rpc("join_challenge_by_code", { p_profile_id: s.profile.id, p_code: code });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app/challenges");
  return { ok: true, data };
}

/** P21: المطابقة التلقائية. */
export async function autoMatchAction(): Promise<ChallengeActionResult> {
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const r = await autoMatch(db, { id: s.profile.id, age_mode: s.profile.age_mode as AgeMode });
  if (!r.ok) return { ok: false, error: mapErr(r.error) };
  revalidatePath("/app/challenges");
  redirect(`/app/challenges/${r.challengeId}`);
}

export async function leaveChallenge(_: unknown, form: FormData): Promise<ChallengeActionResult> {
  const id = z.string().uuid().safeParse(form.get("challenge_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { error } = await db.rpc("leave_challenge", { p_profile_id: s.profile.id, p_challenge: id.data });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app/challenges");
  return { ok: true };
}

/** G13: موافقة المربي على انضمام الطفل. */
export async function approveChallengeJoin(_: unknown, form: FormData): Promise<ChallengeActionResult> {
  const p = z.object({ challenge_id: z.string().uuid(), profile_id: z.string().uuid() }).safeParse({ challenge_id: form.get("challenge_id"), profile_id: form.get("profile_id") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { error } = await db.rpc("approve_challenge_participant", { p_challenge: p.data.challenge_id, p_profile_id: p.data.profile_id });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/guardian", "layout");
  return { ok: true };
}

/** P22: تحديث اللوحة عند الطلب (idempotent). */
export async function refreshBoard(_: unknown, form: FormData): Promise<ChallengeActionResult> {
  const id = z.string().uuid().safeParse(form.get("challenge_id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile) return { ok: false, error: "not_allowed" };
  try { await recomputeChallengeScores(createAdminClient(), id.data); } catch { return { ok: false, error: "recompute_failed" }; }
  revalidatePath(`/app/challenges/${id.data}`);
  return { ok: true };
}
