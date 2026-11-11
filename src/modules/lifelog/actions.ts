"use server";
/**
 * أفعال «سجل حياتي» ورحلة التعارف (0.5 الجزء أ). المنسّق: يستدعي life_intake_assistant إن توفر، ويحفظ المرشحين اقتراحات معلّقة فقط؛
 * لا يدخل السجل شيء إلا بتأكيد المستخدم. في AI-OFF يعمل النموذج الثابت (إضافة يدوية لكل حقل).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession, getPlayerProfile } from "@/modules/accounts";
import { effective } from "@/modules/settings";
import { setSetting } from "@/modules/settings/service";
import { aiEnabled, anthropicCaller } from "@/modules/companion";
import { addContextItem, emptyContext, type PersonalContext } from "@/modules/adaptation/personal-context";
import { todayIn } from "@/modules/missions/queries";
import { loadActiveTemplates } from "@/modules/library";
import type { AgeMode, SupportLevel } from "@/shared/config";
import { support as supportCfg, planner } from "@/shared/config";
import content from "@content/life_log.ar.json";
import { LIFE_FIELDS, blockedReason, followUpAllowed, commitmentText, validCommitment, suggestWindows, provenanceFor, SCENARIO_VARIABLE, type ItemSource, type LifeField } from "./rules";
import * as svc from "./service";
import { lifeIntakeAssist } from "./intake-ai";

export type LifeRes = { ok: true; data?: unknown } | { ok: false; error: string };
const uuid = z.string().uuid();
const field = z.enum(LIFE_FIELDS);
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };

/** الفاعل: صاحب الملف، أو مربٍ يكتب مع الطفل (RLS تفرض manage_settings في child). */
async function actor(profileId: string, via: "typed" | "voice" = "typed") {
  const s = await getSession();
  if (!s) return null;
  const player = await getPlayerProfile(profileId);
  if (!player) return null;
  const own = player.user_id === s.userId;
  const source: ItemSource = own ? (via === "voice" ? "user_voice" : "user_typed") : "guardian_for_child";
  return { userId: s.userId, player, own, source, mode: player.age_mode as AgeMode };
}
const done = (): LifeRes => { revalidatePath("/", "layout"); return { ok: true }; };
const fail = (r: { error: string }): LifeRes => ({ ok: false, error: r.error });

export async function addLifeItemAction(_: unknown, form: FormData): Promise<LifeRes> {
  const p = z.object({ profile_id: uuid, field, text: z.string().trim().min(1).max(300), via: z.enum(["typed", "voice"]).default("typed") }).safeParse({ profile_id: form.get("profile_id"), field: form.get("field"), text: form.get("text") ?? "", via: form.get("via") || "typed" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const a = await actor(p.data.profile_id, p.data.via); if (!a) return { ok: false, error: "not_allowed" };
  const r = await svc.addLifeItem(await createClient(), { profileId: p.data.profile_id, actorId: a.userId, field: p.data.field, text: p.data.text, source: a.source });
  return r.ok ? done() : fail(r);
}
export async function removeLifeItemAction(_: unknown, form: FormData): Promise<LifeRes> {
  const p = z.object({ profile_id: uuid, field, id: z.string().min(1) }).safeParse({ profile_id: form.get("profile_id"), field: form.get("field"), id: form.get("id") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const a = await actor(p.data.profile_id); if (!a) return { ok: false, error: "not_allowed" };
  const r = await svc.removeLifeItem(await createClient(), { profileId: p.data.profile_id, actorId: a.userId, field: p.data.field, id: p.data.id });
  return r.ok ? done() : fail(r);
}
export async function editLifeItemAction(_: unknown, form: FormData): Promise<LifeRes> {
  const p = z.object({ profile_id: uuid, field, id: z.string().min(1), text: z.string().trim().min(1).max(300) }).safeParse({ profile_id: form.get("profile_id"), field: form.get("field"), id: form.get("id"), text: form.get("text") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const a = await actor(p.data.profile_id); if (!a) return { ok: false, error: "not_allowed" };
  const r = await svc.editLifeItem(await createClient(), { profileId: p.data.profile_id, actorId: a.userId, field: p.data.field, id: p.data.id, text: p.data.text });
  return r.ok ? done() : fail(r);
}
export async function confirmLifeItemAction(_: unknown, form: FormData): Promise<LifeRes> {
  const p = z.object({ profile_id: uuid, field, id: z.string().min(1) }).safeParse({ profile_id: form.get("profile_id"), field: form.get("field"), id: form.get("id") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const a = await actor(p.data.profile_id); if (!a) return { ok: false, error: "not_allowed" };
  const r = await svc.confirmLifeItem(await createClient(), { profileId: p.data.profile_id, actorId: a.userId, field: p.data.field, id: p.data.id });
  return r.ok ? done() : fail(r);
}
/** أ.6: «ما تغيّر» */
export async function nothingChangedAction(_: unknown, form: FormData): Promise<LifeRes> {
  const id = uuid.safeParse(form.get("profile_id")); if (!id.success) return { ok: false, error: "invalid_input" };
  const a = await actor(id.data); if (!a) return { ok: false, error: "not_allowed" };
  const r = await svc.confirmNothingChanged(await createClient(), { profileId: id.data, actorId: a.userId });
  return r.ok ? done() : fail(r);
}

// ---------------------------------------------------------------- رحلة التعارف (P52)
export async function intakeStepAction(_: unknown, form: FormData): Promise<LifeRes> {
  const p = z.object({ profile_id: uuid, step: z.coerce.number().int().min(0).max(10) }).safeParse({ profile_id: form.get("profile_id"), step: form.get("step") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const a = await actor(p.data.profile_id); if (!a) return { ok: false, error: "not_allowed" };
  const r = await svc.setIntakeStep(await createClient(), { profileId: p.data.profile_id, actorId: a.userId, step: p.data.step });
  return r.ok ? done() : fail(r);
}
export async function skipIntakeAction(_: unknown, form: FormData): Promise<LifeRes> {
  const id = uuid.safeParse(form.get("profile_id")); if (!id.success) return { ok: false, error: "invalid_input" };
  const a = await actor(id.data); if (!a) return { ok: false, error: "not_allowed" };
  const r = await svc.skipIntake(await createClient(), { profileId: id.data, actorId: a.userId });
  if (!r.ok) return fail(r);
  revalidatePath("/", "layout");
  redirect(a.own ? afterIntakePath(form.get("next")) : `/guardian/${id.data}`);
}
export async function completeIntakeAction(_: unknown, form: FormData): Promise<LifeRes> {
  const id = uuid.safeParse(form.get("profile_id")); if (!id.success) return { ok: false, error: "invalid_input" };
  const a = await actor(id.data); if (!a) return { ok: false, error: "not_allowed" };
  const r = await svc.completeIntake(await createClient(), { profileId: id.data, actorId: a.userId });
  if (!r.ok) return fail(r);
  revalidatePath("/", "layout");
  redirect(a.own ? afterIntakePath(form.get("next")) : `/guardian/${id.data}`);
}
/** أ.3: في الانضمام يحكم onboarding_start_with ما يلي التعارف (path = مرآة الواقع أو الأهداف، context = بناء الغاية)؛ وإلا يعود للتطبيق. */
function afterIntakePath(next: FormDataEntryValue | null): string {
  return next === "path" ? "/onboarding/path" : next === "context" ? "/onboarding/context" : "/app";
}

/** أ.4: رسالة حرة ⇒ مرشحون ببطاقات تأكيد (لا حفظ). عند تعذّر الذكاء الاصطناعي: النموذج الثابت. */
export async function intakeMessageAction(_: unknown, form: FormData): Promise<LifeRes> {
  const p = z.object({ profile_id: uuid, field, text: z.string().trim().min(1).max(1000) }).safeParse({ profile_id: form.get("profile_id"), field: form.get("field"), text: form.get("text") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const a = await actor(p.data.profile_id); if (!a) return { ok: false, error: "not_allowed" };
  if (blockedReason(p.data.text)) return { ok: false, error: "blocked" };
  const admin = adminOrNull();
  const db = await createClient();
  const row = await svc.loadLife(db, p.data.profile_id);
  if (!admin || !aiEnabled()) return { ok: true, data: { source: "fixed", candidates: [], followUp: null } };
  const allowFollowUp = followUpAllowed(row.intake_followups_used);
  const r = await lifeIntakeAssist({ db: admin, caller: anthropicCaller(), profileId: p.data.profile_id, mode: a.mode, field: p.data.field, userMessage: p.data.text, existing: row.log[p.data.field].map((x) => x.text), allowFollowUp });
  if (r.source === "fixed") return { ok: true, data: { source: "fixed", candidates: [], followUp: null } };
  const saved: Array<{ id: string; field: LifeField; text: string }> = [];
  for (const c of r.candidates) {
    const { data } = await admin.from("context_suggestions").insert({ profile_id: p.data.profile_id, field: c.field, value: c.text }).select("id").single();
    if (data) saved.push({ id: (data as { id: string }).id, field: c.field, text: c.text });
  }
  if (r.followUp) await svc.countFollowUp(db, { profileId: p.data.profile_id, actorId: a.userId });
  revalidatePath("/", "layout");
  return { ok: true, data: { source: "ai", candidates: saved, followUp: r.followUp } };
}

/** بطاقة التأكيد: «نعم» تُدخل العنصر السجل (source = companion_suggested_confirmed) بعد التحقق نفسه؛ «لا» ترفضه. */
export async function decideLifeSuggestionAction(_: unknown, form: FormData): Promise<LifeRes> {
  const p = z.object({ suggestion_id: uuid, decision: z.enum(["accepted", "rejected"]) }).safeParse({ suggestion_id: form.get("suggestion_id"), decision: form.get("decision") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession(); if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data: sug } = await db.from("context_suggestions").select("id, profile_id, field, value, status").eq("id", p.data.suggestion_id).maybeSingle();
  if (!sug || sug.status !== "pending" || !(LIFE_FIELDS as readonly string[]).includes(sug.field as string)) return { ok: false, error: "not_found" };
  if (p.data.decision === "accepted") {
    const r = await svc.addLifeItem(db, { profileId: sug.profile_id as string, actorId: s.userId, field: sug.field as LifeField, text: sug.value as string, source: "companion_suggested_confirmed" });
    if (!r.ok) return fail(r);
  }
  await db.from("context_suggestions").update({ status: p.data.decision }).eq("id", sug.id);
  return done();
}

/** أ.3 خطوة 3: التزام ثابت من الشبكة الأسبوعية ⇒ routine (بلا محادثة). */
export async function addCommitmentAction(_: unknown, form: FormData): Promise<LifeRes> {
  const p = z.object({ profile_id: uuid, label: z.string().trim().min(1).max(40), days: z.array(z.coerce.number().int().min(0).max(6)).min(1), from: z.string(), to: z.string() })
    .safeParse({ profile_id: form.get("profile_id"), label: form.get("label") ?? "", days: form.getAll("days"), from: form.get("from"), to: form.get("to") });
  if (!p.success || !validCommitment(p.data)) return { ok: false, error: "invalid_input" };
  const a = await actor(p.data.profile_id); if (!a) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data } = await db.from("personal_context").select("interests, routine, free_windows, contexts").eq("profile_id", p.data.profile_id).maybeSingle();
  const pc: PersonalContext = data ? { interests: (data.interests as string[]) ?? [], routine: (data.routine as string[]) ?? [], free_windows: (data.free_windows as string[]) ?? [], contexts: (data.contexts as string[]) ?? [] } : emptyContext();
  const r = addContextItem(pc, "routine", commitmentText(p.data, content.weekdays));
  if (!r.ok) return { ok: false, error: r.reason === "max_items" ? "max_items" : "blocked" };
  const { error } = await db.from("personal_context").upsert({ profile_id: p.data.profile_id, routine: r.pc.routine, updated_by: a.userId, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
  if (error) return { ok: false, error: "not_allowed" };
  return done();
}
/** اقتراح available_windows من الالتزامات، يُحفظ بموافقة المستخدم (ضغطه الزر). */
export async function suggestWindowsAction(_: unknown, form: FormData): Promise<LifeRes> {
  const id = uuid.safeParse(form.get("profile_id")); if (!id.success) return { ok: false, error: "invalid_input" };
  const a = await actor(id.data); if (!a) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data } = await db.from("personal_context").select("routine").eq("profile_id", id.data).maybeSingle();
  const ranges = ((data?.routine as string[] | undefined) ?? []).flatMap((t) => { const m = t.match(/(\d{2}:\d{2})–(\d{2}:\d{2})\s*$/); return m ? [{ from: m[1]!, to: m[2]! }] : []; });
  const quiet = (await effective<[string, string] | null>(db, id.data, "quiet_hours")).value;
  const gap = (await effective<number>(db, id.data, "free_gap_minutes")).value;
  const windows = suggestWindows(ranges, quiet?.[0] ?? "", gap);
  if (!windows.length) return { ok: false, error: "windows_none" };
  const r = await setSetting(db, { profileId: id.data, key: "available_windows", value: windows, role: a.own ? "player" : "guardian" });
  return r.ok ? done() : { ok: false, error: r.reason };
}

/**
 * أ.5 المصدر الثالث: «عندك موقف قريب من هالشي هالأسبوع؟» — موقف يكتبه المستخدم الآن يصير مهمة من قالب required،
 * ونصه كما كتبه (بعد قائمة المنع). المصدر يُسجَّل user_typed بعميل الخدمة.
 */
export async function startOwnSituationAction(_: unknown, form: FormData): Promise<LifeRes> {
  const text = z.string().trim().min(3).max(120).safeParse(form.get("text"));
  if (!text.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player" || !s.profile.age_mode) return { ok: false, error: "not_allowed" };
  if (blockedReason(text.data)) return { ok: false, error: "blocked" };
  const admin = adminOrNull(); if (!admin) return { ok: false, error: "unavailable" };
  const mode = s.profile.age_mode as AgeMode;
  const tpl = (await loadActiveTemplates(admin)).filter((t) => t.life_binding === "required" && t.age_modes.includes(mode)).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!tpl) return { ok: false, error: "not_found" };
  const cap = Object.entries(tpl.capability_weights).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (planner.ai as unknown as { capability_for_support_level: string }).capability_for_support_level;
  const { data: st } = await admin.from("capability_states").select("support_level").eq("profile_id", s.profile.id).eq("capability_id", cap).maybeSingle();
  const src = { ref_type: "user_typed" as const, ref_id: null, text: text.data };
  const { data, error } = await admin.from("missions").insert({
    profile_id: s.profile.id, template_id: tpl.id, template_version: tpl.version, status: "suggested", difficulty: tpl.difficulty,
    support_level: ((st as { support_level: SupportLevel } | null)?.support_level) ?? supportCfg.initial_by_age_mode[mode],
    variables: { time_budget: tpl.variable_defaults.time_budget ?? tpl.min_duration, [SCENARIO_VARIABLE]: text.data }, variables_provenance: provenanceFor(src),
    source: "self", created_by: s.userId, suggested_for: todayIn(s.profile.timezone),
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  redirect(`/app/missions/${(data as { id: string }).id}`);
}
