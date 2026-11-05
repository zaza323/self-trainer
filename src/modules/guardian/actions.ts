"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { GUARDIAN_PERMISSIONS, GUARDIAN_RELATIONS, normalizePermissions } from "@/shared/config/permissions";
import type { ActionResult } from "@/modules/accounts/actions";

function permissionsFromForm(form: FormData) {
  return normalizePermissions(Object.fromEntries(GUARDIAN_PERMISSIONS.map((p) => [p, form.get(`perm_${p}`) === "on"])));
}

const inviteSchema = z.object({
  player_id: z.string().uuid(),
  relation: z.enum(GUARDIAN_RELATIONS),
  email: z.string().email().optional().or(z.literal("")),
});

/** ACC-7: صاحب الحساب (أو من له manage_guardians) ينشئ دعوة برمز. */
export async function createGuardianInvite(_: unknown, form: FormData): Promise<ActionResult & { code?: string }> {
  const parsed = inviteSchema.safeParse({ player_id: form.get("player_id"), relation: form.get("relation"), email: form.get("email") ?? "" });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return { ok: false, error: "not_authenticated" };
  const { data, error } = await db
    .from("guardian_invites")
    .insert({
      player_id: parsed.data.player_id,
      invited_by: u.user.id,
      relation: parsed.data.relation,
      email: parsed.data.email || null,
      permissions: permissionsFromForm(form),
    })
    .select("code")
    .single();
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, code: data.code as string };
}

export async function acceptGuardianInvite(_: unknown, form: FormData): Promise<ActionResult> {
  const code = String(form.get("code") ?? "").trim();
  if (!/^[a-f0-9]{12}$/i.test(code)) return { ok: false, error: "invalid_code" };
  const db = await createClient();
  const { error } = await db.rpc("accept_guardian_invite", { p_code: code.toLowerCase() });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/", "layout");
  return { ok: true };
}

const linkSchema = z.object({ link_id: z.string().uuid(), relation: z.enum(GUARDIAN_RELATIONS).optional() });

/** ACC-8: منح/سحب الصلاحيات وتغيير الصفة. */
export async function updateGuardianLink(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = linkSchema.safeParse({ link_id: form.get("link_id"), relation: form.get("relation") || undefined });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const patch: Record<string, unknown> = { permissions: permissionsFromForm(form) };
  if (parsed.data.relation) patch.relation = parsed.data.relation;
  const { data, error } = await db.from("guardian_links").update(patch).eq("id", parsed.data.link_id).select("id");
  if (error) return { ok: false, error: mapErr(error.message) };
  if (!data?.length) return { ok: false, error: "not_allowed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeGuardianLink(_: unknown, form: FormData): Promise<ActionResult> {
  const linkId = String(form.get("link_id") ?? "");
  if (!z.string().uuid().safeParse(linkId).success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { data, error } = await db.from("guardian_links").update({ status: "removed" }).eq("id", linkId).select("id");
  if (error) return { ok: false, error: mapErr(error.message) };
  if (!data?.length) return { ok: false, error: "not_allowed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

function mapErr(msg: string) {
  if (/receive_alerts/.test(msg)) return "last_alert_guardian";
  if (/creator guardian link/.test(msg)) return "creator_cannot_be_removed";
  if (/invalid or expired/.test(msg)) return "invite_invalid";
  if (/own guardian/.test(msg)) return "cannot_self_guardian";
  if (/row-level security/.test(msg)) return "not_allowed";
  return msg;
}
