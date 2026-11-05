"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { track } from "@/modules/trial";
import { MECHANIC_IDS, type AgeMode, type MechanicId } from "@/shared/config";
import { getSession, getPlayerProfile } from "@/modules/accounts";
import { getMission, todayIn } from "@/modules/missions";
import { primaryCapability } from "@/modules/library";
import { aiEnabled, anthropicCaller, classifyTask } from "@/modules/companion";
import { evaluateRewardTriggers } from "@/modules/rewards";
import { createCustomTemplate, selfMissionNeedsApproval, afterTransferReport, afterTransferConfirmed, afterObservation, observationCapability } from "./service";
import contextTags from "@content/context_tags.ar.json";
import observations from "@content/guardian_observations.ar.json";

export type LifeActionResult = { ok: true; data?: unknown } | { ok: false; error: string };
const uuid = z.string().uuid();
const CONTEXTS = Object.keys(contextTags).filter((k) => !k.startsWith("_")) as [string, ...string[]];

/**
 * LIFE-3 / MIS-2 / MIS-10: مهمة واقعية من المربي (add_missions) أو من المتدرب نفسه. الذكاء الاصطناعي يصنّفها إن كان متاحًا
 * (task_classifier) وإلا يختار المستخدم الميكانيكية يدويًا. في child مع الإعداد: تنتظر موافقة المربي.
 */
export async function createRealMission(_: unknown, form: FormData): Promise<LifeActionResult> {
  const p = z.object({
    profile_id: uuid, title: z.string().trim().min(1).max(200), situation: z.string().trim().max(600).optional().or(z.literal("")),
    mechanic: z.enum(MECHANIC_IDS).optional().or(z.literal("")), minutes: z.coerce.number().int().min(5).max(180).default(20),
    recurring: z.string().optional(), days: z.array(z.coerce.number().int().min(0).max(6)).optional(), time_local: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal("")),
  }).safeParse({ profile_id: form.get("profile_id"), title: form.get("title"), situation: form.get("situation") ?? "", mechanic: form.get("mechanic") ?? "", minutes: form.get("minutes") || 20, recurring: form.get("recurring") ?? undefined, days: form.getAll("days"), time_local: form.get("time_local") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const player = await getPlayerProfile(p.data.profile_id);
  if (!player) return { ok: false, error: "not_found" };
  const isSelf = player.user_id === s.userId;
  const mode = player.age_mode as AgeMode;
  const db = await createClient();
  const admin = createAdminClient();

  // التصنيف: الذكاء الاصطناعي ثم اليدوي (7.2: السقوط = اختيار يدوي)
  let mechanic: MechanicId | null = p.data.mechanic || null;
  let weights: Record<string, number> | undefined, prompts: string[] | undefined;
  if (!mechanic && aiEnabled()) {
    const { data: goals } = await db.from("goals").select("id, title").eq("profile_id", player.id).eq("status", "active");
    const c = await classifyTask({ db: admin, caller: anthropicCaller(), profileId: player.id, mode, text: `${p.data.title}\n${p.data.situation ?? ""}`, goals: ((goals ?? []) as Array<{ id: string; title: string }>) });
    if (c) { mechanic = c.mechanic; weights = c.capability_weights as Record<string, number>; prompts = c.reflection_prompts; }
  }
  if (!mechanic) return { ok: false, error: "mechanic_required" };

  const tpl = await createCustomTemplate(admin, { profileId: player.id, mode, createdBy: s.userId, title: p.data.title, situation: p.data.situation || p.data.title, mechanic, capabilityWeights: weights, reflectionPrompts: prompts, trainingLevel: isSelf ? "independent_real" : "guided_real", minutes: p.data.minutes });
  const today = todayIn(player.timezone);
  const { data: st } = await db.from("capability_states").select("support_level").eq("profile_id", player.id).eq("capability_id", primaryCapability({ capability_weights: weights ?? {} }) || "autonomy").maybeSingle();
  const support = (st?.support_level as string) ?? "L1_hint";

  if (p.data.recurring === "on" && !isSelf) {
    const days = [...new Set(p.data.days ?? [])];
    if (days.length === 0) return { ok: false, error: "days_required" };
    const { error } = await db.from("mission_schedules").insert({ profile_id: player.id, created_by: s.userId, template_id: tpl.id, template_version: tpl.version, days_of_week: days, time_local: p.data.time_local || null });
    if (error) return { ok: false, error: mapErr(error.message) };
  } else {
    const needsApproval = isSelf ? await selfMissionNeedsApproval(db, player.id, mode) : false;
    const { error } = await db.from("missions").insert({ profile_id: player.id, template_id: tpl.id, template_version: tpl.version, status: "suggested", difficulty: 2, support_level: support, variables: { time_budget: p.data.minutes, context: p.data.title }, source: isSelf ? "self" : "guardian", needs_approval: needsApproval, created_by: s.userId, suggested_for: today, context_tag: "other" });
    if (error) return { ok: false, error: mapErr(error.message) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** MIS-2: موافقة المربي على مهمة كتبها الطفل. */
export async function approveMission(_: unknown, form: FormData): Promise<LifeActionResult> {
  const id = String(form.get("mission_id"));
  if (!uuid.safeParse(id).success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { error } = await db.rpc("approve_mission", { p_mission_id: id });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** LIFE-2 / P11: تقرير نقل بصيغة: أين؟ ماذا فعلت؟ هل نجح؟ */
export async function submitTransferReport(_: unknown, form: FormData): Promise<LifeActionResult> {
  const p = z.object({ mission_id: uuid.optional().or(z.literal("")), capability_id: z.string().min(1), context_tag: z.enum(CONTEXTS), what: z.string().trim().min(1).max(500), worked: z.enum(["true", "false"]) })
    .safeParse({ mission_id: form.get("mission_id") ?? "", capability_id: form.get("capability_id"), context_tag: form.get("context_tag"), what: form.get("what"), worked: form.get("worked") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return { ok: false, error: "not_allowed" };
  if (p.data.mission_id) { const m = await getMission(p.data.mission_id); if (!m || m.mission.profile_id !== s.profile.id) return { ok: false, error: "not_found" }; }
  const db = await createClient();
  const { data, error } = await db.from("transfer_reports").insert({ profile_id: s.profile.id, mission_id: p.data.mission_id || null, capability_id: p.data.capability_id, context_tag: p.data.context_tag, what: p.data.what, worked: p.data.worked === "true" }).select("id").single();
  if (error) return { ok: false, error: mapErr(error.message) };
  try {
    const admin = createAdminClient();
    await track(createAdminClient(), { event: "transfer_reported", profileId: s.profile.id, props: { worked: p.data.worked } }).catch(() => {});
  await afterTransferReport(admin, { id: data.id as string, profile_id: s.profile.id, mission_id: p.data.mission_id || null, capability_id: p.data.capability_id, context_tag: p.data.context_tag, worked: p.data.worked === "true" });
    await evaluateRewardTriggers(admin, s.profile.id);
  } catch (e) { console.error("transfer post-processing failed", e); }
  revalidatePath("/", "layout");
  if (p.data.mission_id) redirect(`/app/missions/${p.data.mission_id}`);
  return { ok: true };
}

/** 5.6: المربي يؤكد تقرير النقل (view_progress). */
export async function confirmTransfer(_: unknown, form: FormData): Promise<LifeActionResult> {
  const id = String(form.get("report_id"));
  if (!uuid.safeParse(id).success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data, error } = await db.from("transfer_reports").update({ guardian_confirmed: true, confirmed_by: s.userId, confirmed_at: new Date().toISOString() }).eq("id", id).eq("guardian_confirmed", false).select("id, profile_id, capability_id, context_tag, worked");
  if (error) return { ok: false, error: mapErr(error.message) };
  if (!data?.length) return { ok: false, error: "not_allowed" };
  try { await afterTransferConfirmed(createAdminClient(), data[0] as { id: string; profile_id: string; capability_id: string; context_tag: string; worked: boolean }); } catch (e) { console.error(e); }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** GUARD-3: ملاحظة مربٍ بصيغة محددة. */
export async function addObservation(_: unknown, form: FormData): Promise<LifeActionResult> {
  const types = Object.keys(observations.types) as [string, ...string[]];
  const p = z.object({ profile_id: uuid, observation_type: z.enum(types), note_short: z.string().trim().max(200).optional().or(z.literal("")), context_tag: z.enum(CONTEXTS).default("home") })
    .safeParse({ profile_id: form.get("profile_id"), observation_type: form.get("observation_type"), note_short: form.get("note_short") ?? "", context_tag: form.get("context_tag") || "home" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const cap = observationCapability(p.data.observation_type);
  if (!cap) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { data, error } = await db.from("guardian_observations").insert({ guardian_id: s.userId, profile_id: p.data.profile_id, capability_id: cap, observation_type: p.data.observation_type, note_short: p.data.note_short || null, context_tag: p.data.context_tag }).select("id").single();
  if (error) return { ok: false, error: mapErr(error.message) };
  try { await afterObservation(createAdminClient(), { id: data.id as string, profile_id: p.data.profile_id, capability_id: cap, observation_type: p.data.observation_type, context_tag: p.data.context_tag }); } catch (e) { console.error(e); }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** GUARD-9: دعم أكثر مؤقتًا لقدرة (خفض درجة واحدة لمدة من الإعدادات). */
export async function requestMoreSupport(_: unknown, form: FormData): Promise<LifeActionResult> {
  const p = z.object({ profile_id: uuid, capability_id: z.string().min(1) }).safeParse({ profile_id: form.get("profile_id"), capability_id: form.get("capability_id") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const { data, error } = await db.rpc("request_more_support", { p_profile_id: p.data.profile_id, p_capability_id: p.data.capability_id });
  if (error) return { ok: false, error: mapErr(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, data };
}

function mapErr(m: string) {
  if (/row-level security/.test(m)) return "not_allowed";
  if (/not allowed/.test(m)) return "not_allowed";
  if (/not pending approval/.test(m)) return "not_pending";
  return m;
}
