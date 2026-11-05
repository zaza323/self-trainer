"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { AGE_MODES, type AgeMode } from "@/shared/config";
import { GUARDIAN_RELATIONS } from "@/shared/config/permissions";
import dataPolicy from "@content/data_policy.ar.json";
import { getSession } from "./queries";
import { childEmailFromCode } from "./child-email";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };


async function siteUrl() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(72) });

export async function signUpWithEmail(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: "invalid_credentials" };
  const db = await createClient();
  const { data, error } = await db.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${await siteUrl()}/auth/callback?next=/onboarding` },
  });
  if (error) return { ok: false, error: error.message };
  if (data.session) redirect("/onboarding");
  return { ok: true, message: "check_email" };
}

export async function signInWithEmail(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: "invalid_credentials" };
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: "invalid_credentials" };
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") ? next : "/");
}

/** دخول الطفل برمز الدخول + كلمة السر (الرمز يُحوَّل إلى بريد اصطناعي داخلي). */
export async function signInChild(_: unknown, form: FormData): Promise<ActionResult> {
  const code = String(form.get("login_code") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!/^[a-z0-9_-]{3,24}$/i.test(code) || password.length < 6) return { ok: false, error: "invalid_credentials" };
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword({ email: childEmailFromCode(code), password });
  if (error) return { ok: false, error: "invalid_credentials" };
  redirect("/app");
}

export async function signInWithGoogle(): Promise<void> {
  const db = await createClient();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=/onboarding` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOut() {
  const db = await createClient();
  await db.auth.signOut();
  redirect("/login");
}

const createProfileSchema = z.object({
  kind: z.enum(["player", "guardian"]),
  age_mode: z.enum(["teen", "adult"]).optional(),
  display_name: z.string().trim().min(1).max(60),
  timezone: z.string().trim().min(1).max(64).default("Asia/Amman"),
});

/** P01: إنشاء ملف المستخدم الحالي (teen / adult / مربٍ). child ليس هنا (ACC-3). */
export async function createOwnProfile(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = createProfileSchema.safeParse({
    kind: form.get("kind"),
    age_mode: form.get("age_mode") || undefined,
    display_name: form.get("display_name"),
    timezone: form.get("timezone") || "Asia/Amman",
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.profile) redirect("/");
  const { kind, age_mode, display_name, timezone } = parsed.data;
  if (kind === "player" && !age_mode) return { ok: false, error: "age_mode_required" };
  const db = await createClient();
  const { error } = await db.from("profiles").insert({
    user_id: s.userId,
    kind,
    age_mode: kind === "player" ? age_mode : null,
    display_name,
    timezone,
    onboarded_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  redirect(kind === "guardian" ? "/guardian" : "/onboarding/context");
}

const createChildSchema = z.object({
  display_name: z.string().trim().min(1).max(60),
  login_code: z.string().trim().regex(/^[a-z0-9_-]{3,24}$/i),
  password: z.string().min(6).max(72),
  relation: z.enum(GUARDIAN_RELATIONS),
  consent: z.literal("on"),
  timezone: z.string().trim().min(1).max(64).default("Asia/Amman"),
});

/** G01: المربي ينشئ حساب الطفل ويوافق على سياسة البيانات (ACC-3, 8.2). */
export async function createChildProfile(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = createChildSchema.safeParse({
    display_name: form.get("display_name"),
    login_code: form.get("login_code"),
    password: form.get("password"),
    relation: form.get("relation"),
    consent: form.get("consent"),
    timezone: form.get("timezone") || "Asia/Amman",
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile) redirect("/onboarding");

  const admin = createAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: childEmailFromCode(parsed.data.login_code),
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { kind: "child", created_by: s.userId },
  });
  if (createErr || !created.user) return { ok: false, error: createErr?.message ?? "create_user_failed" };

  const { data: profileId, error } = await admin.rpc("create_child_profile", {
    p_child_user_id: created.user.id,
    p_guardian_user_id: s.userId,
    p_display_name: parsed.data.display_name,
    p_login_code: parsed.data.login_code.toLowerCase(),
    p_relation: parsed.data.relation,
    p_policy_version: dataPolicy.policy_version,
    p_timezone: parsed.data.timezone,
  });
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: error.message };
  }
  redirect(`/guardian/${profileId}`);
}

const transitionSchema = z.object({ profile_id: z.string().uuid(), to: z.enum(AGE_MODES) });

/** ACC-11: تغيير الوضع العمري عبر الدالة الذرّية في قاعدة البيانات (قواعد القسم 13). */
export async function transitionAgeMode(_: unknown, form: FormData): Promise<ActionResult> {
  const parsed = transitionSchema.safeParse({ profile_id: form.get("profile_id"), to: form.get("to") });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { error } = await db.rpc("transition_age_mode", { p_profile_id: parsed.data.profile_id, p_new_mode: parsed.data.to as AgeMode });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
