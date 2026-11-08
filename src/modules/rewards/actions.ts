"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { validateTrigger } from "./triggers";
import { evaluateRewardTriggers } from "./service";

export type RewardActionResult = { ok: true; id?: string } | { ok: false; error: string; explanation?: string };
const uuid = z.string().uuid();

function parseParams(form: FormData): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const k of ["capability_id", "level", "achievement_code", "goal_id"]) { const v = form.get(`param_${k}`); if (v) p[k] = String(v); }
  for (const k of ["count", "min_distinct_contexts"]) { const v = form.get(`param_${k}`); if (v) p[k] = Number(v); }
  return p;
}

/** REWARD-1/2/7: إنشاء مكافأة (المربي صاحب add_rewards أو البالغ لنفسه). surprise تُنشأ earned مباشرة؛ غيرها draft ثم active عند الإعلان. */
export async function createReward(_: unknown, form: FormData): Promise<RewardActionResult> {
  const p = z.object({ profile_id: uuid, title: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional().or(z.literal("")), icon: z.string().trim().max(8).optional().or(z.literal("")), trigger_type: z.string(), activate: z.string().optional() })
    .safeParse({ profile_id: form.get("profile_id"), title: form.get("title"), description: form.get("description") ?? "", icon: form.get("icon") ?? "", trigger_type: form.get("trigger_type"), activate: form.get("activate") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data: ach } = await db.from("achievements").select("code");
  const { data: goals } = await db.from("goals").select("id").eq("profile_id", p.data.profile_id);
  const v = validateTrigger(p.data.trigger_type, parseParams(form), { allowSurprise: true, achievementCodes: ((ach ?? []) as Array<{ code: string }>).map((a) => a.code), goalIds: ((goals ?? []) as Array<{ id: string }>).map((g) => g.id) });
  if (!v.ok) return { ok: false, error: v.reason, explanation: v.explanation };
  // لا كتابة مباشرة على rewards (الهجرة 0017): دالة لدور الخدمة تتحقق من الصلاحية بهوية الجلسة
  const { data, error } = await createAdminClient().rpc("reward_create", { p_actor: s.userId, p_profile_id: p.data.profile_id, p_title: p.data.title, p_description: p.data.description || null, p_icon: p.data.icon || "🎁", p_trigger_type: v.type, p_trigger_params: v.params, p_status: p.data.activate === "on" && v.type !== "surprise" ? "active" : "draft" });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, id: data as string };
}

/** REWARD-3: دورة الحالات. المتدرب: acknowledged فقط. المربي: active/delivered/cancelled. */
export async function transitionReward(_: unknown, form: FormData): Promise<RewardActionResult> {
  const p = z.object({ reward_id: uuid, to: z.enum(["active", "delivered", "acknowledged", "cancelled"]) }).safeParse({ reward_id: form.get("reward_id"), to: form.get("to") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const { data, error } = await createAdminClient().rpc("reward_transition", { p_actor: s.userId, p_id: p.data.reward_id, p_to: p.data.to });
  if (error) return { ok: false, error: mapErr(error.message) };
  const row = ((data ?? []) as Array<{ id: string; profile_id: string; title: string }>)[0];
  if (!row) return { ok: false, error: "not_allowed" };
  if (p.data.to === "cancelled") await createAdminClient().from("notifications").insert({ profile_id: row.profile_id, type: "reward_cancelled", payload: { reward_id: p.data.reward_id, title: row.title } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** GAME-10: إنجاز خاص (المحفزات المسموحة عدا surprise). */
export async function createCustomAchievement(_: unknown, form: FormData): Promise<RewardActionResult> {
  const p = z.object({ profile_id: uuid, name: z.string().trim().min(1).max(80), icon: z.string().trim().max(8).optional().or(z.literal("")), trigger_type: z.string() }).safeParse({ profile_id: form.get("profile_id"), name: form.get("name"), icon: form.get("icon") ?? "", trigger_type: form.get("trigger_type") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data: ach } = await db.from("achievements").select("code");
  const v = validateTrigger(p.data.trigger_type, parseParams(form), { allowSurprise: false, achievementCodes: ((ach ?? []) as Array<{ code: string }>).map((a) => a.code) });
  if (!v.ok) return { ok: false, error: v.reason, explanation: v.explanation };
  const code = `custom-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await db.from("achievements").insert({ code, name_by_mode: { child: p.data.name, teen: p.data.name, adult: p.data.name }, description_by_mode: {}, icon: p.data.icon || "★", owner_profile_id: p.data.profile_id, created_by: s.userId, trigger_type: v.type, trigger_params: v.params });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function reevaluateRewards(profileId: string) {
  try { await evaluateRewardTriggers(createAdminClient(), profileId); } catch { /* بلا مفتاح خدمة محليًا */ }
}

function mapErr(m: string) {
  if (/not_permitted/.test(m)) return "not_allowed";
  if (/forbidden_trigger/.test(m)) return "forbidden";
  if (/max_active_rewards/.test(m)) return "max_active";
  if (/not allowed/.test(m)) return "bad_transition";
  if (/row-level security/.test(m)) return "not_allowed";
  return m;
}
