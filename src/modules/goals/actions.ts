"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { limits } from "@/shared/config";
import { getSession } from "@/modules/accounts";
import { chainToRoot, wouldCycle } from "./tree";
import type { GoalRow } from "./queries";

export type GoalActionResult = { ok: true; id?: string } | { ok: false; error: string };

const title = z.string().trim().min(1).max(200);
const why = z.string().trim().max(1000).optional().or(z.literal(""));

async function ownerProfileId() {
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return null;
  return s.profile.id;
}

/** إنشاء غاية (جذر أو ابنة). كل غاية لها "لماذا" بكلمات المستخدم. */
export async function createGoal(_: unknown, form: FormData): Promise<GoalActionResult> {
  const parsed = z.object({ title, why, parent_goal_id: z.string().uuid().optional().or(z.literal("")) }).safeParse({
    title: form.get("title"), why: form.get("why") ?? "", parent_goal_id: form.get("parent_goal_id") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const profileId = await ownerProfileId();
  if (!profileId) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data, error } = await db.from("goals").insert({
    profile_id: profileId, title: parsed.data.title, why: parsed.data.why || null,
    parent_goal_id: parsed.data.parent_goal_id || null,
  }).select("id").single();
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, id: data.id as string };
}

/** GOAL-5: إدراج حلقة فوق غاية (فوق الجذر أو بين حلقتين). */
export async function insertGoalAbove(_: unknown, form: FormData): Promise<GoalActionResult> {
  const parsed = z.object({ child_id: z.string().uuid(), title, why }).safeParse({ child_id: form.get("child_id"), title: form.get("title"), why: form.get("why") ?? "" });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { data, error } = await db.rpc("insert_goal_above", { p_child: parsed.data.child_id, p_title: parsed.data.title, p_why: parsed.data.why || null });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, id: data as string };
}

/** GOAL-5: نقل غاية إلى أب آخر دون فقدان المهام (المهام تشير إلى goal_id الثابت). */
export async function moveGoal(_: unknown, form: FormData): Promise<GoalActionResult> {
  const parsed = z.object({ goal_id: z.string().uuid(), new_parent_id: z.string().uuid().optional().or(z.literal("")) }).safeParse({ goal_id: form.get("goal_id"), new_parent_id: form.get("new_parent_id") ?? "" });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const profileId = await ownerProfileId();
  if (!profileId) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data: goals } = await db.from("goals").select("*").eq("profile_id", profileId);
  const all = (goals ?? []) as GoalRow[];
  const newParent = parsed.data.new_parent_id || null;
  if (wouldCycle(all, parsed.data.goal_id, newParent)) return { ok: false, error: "cycle" };
  if (newParent && chainToRoot(all, newParent).length >= limits.goal_max_depth) return { ok: false, error: "too_deep" };
  const { error } = await db.from("goals").update({ parent_goal_id: newParent }).eq("id", parsed.data.goal_id);
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function updateGoal(_: unknown, form: FormData): Promise<GoalActionResult> {
  const parsed = z.object({ goal_id: z.string().uuid(), title: title.optional(), why, status: z.enum(["active", "completed", "archived"]).optional() }).safeParse({
    goal_id: form.get("goal_id"), title: form.get("title") ?? undefined, why: form.get("why") ?? "", status: form.get("status") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const patch: Record<string, unknown> = {};
  if (parsed.data.title) patch.title = parsed.data.title;
  if (form.has("why")) patch.why = parsed.data.why || null;
  if (parsed.data.status) patch.status = parsed.data.status;
  const db = await createClient();
  const { error } = await db.from("goals").update(patch).eq("id", parsed.data.goal_id);
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true };
}

function mapErr(m: string) {
  if (/cycle/.test(m)) return "cycle";
  if (/depth exceeds/.test(m)) return "too_deep";
  if (/row-level security/.test(m)) return "not_allowed";
  return m;
}

/** P02 بلا ذكاء اصطناعي: حفظ سلسلة كاملة من الأعلى (الجذر) إلى الأسفل (الخطوة الأولى). */
export async function createGoalChain(_: unknown, form: FormData): Promise<GoalActionResult> {
  const titles = form.getAll("title").map((t) => String(t).trim());
  const whys = form.getAll("why").map((w) => String(w).trim());
  const firstStep = String(form.get("first_step") ?? "").trim();
  if (titles.length === 0 || titles.length !== whys.length || titles.some((t) => !t || t.length > 200)) return { ok: false, error: "invalid_input" };
  if (titles.length + (firstStep ? 1 : 0) > limits.goal_max_depth) return { ok: false, error: "too_deep" };
  const profileId = await ownerProfileId();
  if (!profileId) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  let parent: string | null = null;
  let leaf: string | null = null;
  // النموذج يرسل الحلقات من الأقرب إلى الأبعد؛ نحفظ من الجذر نزولًا
  for (let i = titles.length - 1; i >= 0; i--) {
    const { data, error } = await db.from("goals").insert({ profile_id: profileId, parent_goal_id: parent, title: titles[i], why: whys[i] || null }).select("id").single();
    if (error) return { ok: false, error: mapErr(error.message) };
    parent = data.id as string;
    leaf = parent;
  }
  if (firstStep) {
    const { data, error } = await db.from("goals").insert({ profile_id: profileId, parent_goal_id: parent, title: firstStep, why: titles[0] ? `خطوة أولى نحو: ${titles[0]}` : null }).select("id").single();
    if (error) return { ok: false, error: mapErr(error.message) };
    leaf = data.id as string;
  }
  revalidatePath("/app", "layout");
  return { ok: true, id: leaf ?? undefined };
}
