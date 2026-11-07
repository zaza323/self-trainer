"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { effective } from "@/modules/settings";
import { instantForLocal } from "@/modules/notifications/plan";
import { addActualBlock, removeActualBlock, completeReconstruction, saveMirror, saveNoticed, chooseChange, categoriesFor, saveGoalAnswer } from "./service";
import { evidenceFromFreeText } from "@/modules/planner/reflection-evidence";
import { localParts } from "@/modules/notifications/plan";
import { aiEnabled, anthropicCaller } from "@/modules/companion";
import { dayReconstructor } from "@/modules/planner/ai";
import { parseDayText } from "./day-text";
import type { AgeMode } from "@/shared/config";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };
async function owner() { const s = await getSession(); if (!s?.profile || s.profile.kind !== "player") return null; return { id: s.profile.id, age_mode: s.profile.age_mode as AgeMode, timezone: s.profile.timezone }; }

export async function addSegmentAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ reconstruction_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/), category: z.string().min(1).max(40), label: z.string().trim().max(60).optional().or(z.literal("")), energy: z.enum(["high", "normal", "low"]).optional().or(z.literal("")) })
    .safeParse({ reconstruction_id: form.get("reconstruction_id"), date: form.get("date"), from: form.get("from"), to: form.get("to"), category: form.get("category"), label: form.get("label") ?? "", energy: form.get("energy") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const d = p.data;
  const r = await addActualBlock(await createClient(), { reconstructionId: d.reconstruction_id, startsAt: instantForLocal(d.date, d.from, o.timezone).toISOString(), endsAt: instantForLocal(d.date, d.to, o.timezone).toISOString(), category: d.category, label: d.label || null, energy: d.energy || null, origin: "manual" });
  if (!r.ok) return { ok: false, error: r.error ?? "failed" };
  revalidatePath("/app/mirror", "layout");
  return { ok: true };
}
export async function removeSegmentAction(_: unknown, form: FormData): Promise<Res> {
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "invalid_input" };
  if (!(await owner())) return { ok: false, error: "not_allowed" };
  await removeActualBlock(await createClient(), id.data);
  revalidatePath("/app/mirror", "layout");
  return { ok: true };
}
export async function completeReconstructionAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ reconstruction_id: z.string().uuid(), screen_min: z.coerce.number().int().min(0).max(1440).optional().or(z.literal("")), next: z.string().optional() }).safeParse({ reconstruction_id: form.get("reconstruction_id"), screen_min: form.get("screen_min") ?? "", next: form.get("next") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const r = await completeReconstruction(await createClient(), adminOrNull(), o, { reconstructionId: p.data.reconstruction_id, screenEstimateMin: typeof p.data.screen_min === "number" ? p.data.screen_min : null });
  if (!r.ok) return { ok: false, error: "save_failed" };
  revalidatePath("/app/mirror", "layout");
  if (p.data.next === "predict") redirect("/app/mirror/predict");
  return { ok: true, data: r };
}
/** P49: التوقّع ثم إنشاء المرآة (R1). */
export async function predictAndMirrorAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ categories: z.array(z.string().min(1)).min(1).max(3), hours: z.array(z.coerce.number().min(0).max(24)).min(1) }).safeParse({ categories: form.getAll("category"), hours: form.getAll("hours") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const days = (await effective<number>(db, o.id, "mirror_days_required")).value;
  const r = await saveMirror(db, adminOrNull(), o, { days, predictions: p.data.categories.map((c, i) => ({ category: c, predicted_hours: p.data.hours[i] ?? 0 })), now: new Date() });
  if (!r.ok) return { ok: false, error: "no_days" };
  redirect(`/app/mirror/${r.id}`);
}
export async function noticedAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ report_id: z.string().uuid(), text: z.string().trim().min(1).max(1000) }).safeParse({ report_id: form.get("report_id"), text: form.get("text") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  await saveNoticed(await createClient(), p.data.report_id, p.data.text);
  // R2: «شو لفت نظرك؟» ⇒ reflection_quality على self_awareness عبر مرشح reflection_coach (مصدر ai)
  const admin = adminOrNull();
  if (admin && aiEnabled()) await evidenceFromFreeText(admin, anthropicCaller(), o, { ruleId: "R2", capability: "self_awareness", text: p.data.text, dedupeKey: p.data.report_id, context: "سؤال المرآة: شو أكتر شي لفت نظرك؟" });
  revalidatePath("/app/mirror", "layout");
  return { ok: true };
}
export async function chooseChangeAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ report_id: z.string().uuid(), text: z.string().trim().min(1).max(300) }).safeParse({ report_id: form.get("report_id"), text: form.get("text") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const r = await chooseChange(await createClient(), adminOrNull(), o, { reportId: p.data.report_id, text: p.data.text });
  revalidatePath("/app/mirror", "layout");
  return r.ok ? { ok: true, data: r } : { ok: false, error: "save_failed" };
}
/** P01b: اختيار المسار عند الانضمام. */
export async function onboardingPathAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ path: z.enum(["reality", "goals"]) }).safeParse({ path: form.get("path") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  await (await createClient()).from("profiles").update({ onboarding_path: p.data.path }).eq("id", o.id);
  redirect(p.data.path === "reality" ? "/app/mirror/reconstruct?date=yesterday&source=onboarding" : "/onboarding/context");
}

/** ط.3 الطريقة الثانية: كلام حر ⇒ معاينة إلزامية (لا حفظ هنا). day_reconstructor متحقق، وإلا المحلّل الحتمي. */
export async function reconstructTextAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ reconstruction_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), text: z.string().trim().min(3).max(2000) }).safeParse({ reconstruction_id: form.get("reconstruction_id"), date: form.get("date"), text: form.get("text") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const cats = (await categoriesFor(db, o.id)).map((c) => c.key);
  const { data: existing } = await db.from("time_blocks_actual").select("starts_at, ends_at").eq("reconstruction_id", p.data.reconstruction_id);
  const known = ((existing ?? []) as Array<{ starts_at: string; ends_at: string }>).flatMap((b) => [localParts(new Date(b.starts_at), o.timezone).hhmm, localParts(new Date(b.ends_at), o.timezone).hhmm]);
  const now = localParts(new Date(), o.timezone);
  const nowHHMM = now.date === p.data.date ? now.hhmm : null;
  const admin = adminOrNull();
  const r = admin && aiEnabled()
    ? await dayReconstructor({ db: admin, caller: anthropicCaller(), profileId: o.id, mode: o.age_mode, text: p.data.text, categories: cats, knownBoundaries: known, nowHHMM })
    : { ...parseDayText(p.data.text, cats, nowHHMM), source: "deterministic" as const };
  return { ok: true, data: r };
}

/** تأكيد المعاينة: حفظ المقاطع كما عدّلها المستخدم (origin ai_parsed أو chat). */
export async function confirmTextBlocksAction(_: unknown, form: FormData): Promise<Res> {
  const blk = z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), category: z.string().min(1).max(40), label: z.string().max(60).nullable().optional() });
  const p = z.object({ reconstruction_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.enum(["ai", "deterministic"]), blocks: z.string() }).safeParse({ reconstruction_id: form.get("reconstruction_id"), date: form.get("date"), source: form.get("source"), blocks: form.get("blocks") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  let blocks: Array<z.infer<typeof blk>>;
  try { blocks = z.array(blk).min(1).max(40).parse(JSON.parse(p.data.blocks)); } catch { return { ok: false, error: "invalid_input" }; }
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  for (const b of blocks) {
    const r = await addActualBlock(db, { reconstructionId: p.data.reconstruction_id, startsAt: instantForLocal(p.data.date, b.start, o.timezone).toISOString(), endsAt: instantForLocal(p.data.date, b.end, o.timezone).toISOString(), category: b.category, label: b.label || null, origin: p.data.source === "ai" ? "ai_parsed" : "chat" });
    if (!r.ok) return { ok: false, error: r.error ?? "failed" };
  }
  revalidatePath("/app/mirror", "layout");
  return { ok: true, data: { saved: blocks.length } };
}

/** ط.6-4 فحص الغايات مكتوبًا ⇒ R3 (motive_awareness، مصدر ai). */
export async function goalAnswerAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ report_id: z.string().uuid(), text: z.string().trim().min(1).max(1000) }).safeParse({ report_id: form.get("report_id"), text: form.get("text") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner(); if (!o) return { ok: false, error: "not_allowed" };
  await saveGoalAnswer(await createClient(), p.data.report_id, p.data.text);
  const admin = adminOrNull();
  if (admin && aiEnabled()) await evidenceFromFreeText(admin, anthropicCaller(), o, { ruleId: "R3", capability: "motive_awareness", text: p.data.text, dedupeKey: p.data.report_id, context: "فحص الغايات: هالغاية لسا مهمة إلك؟ وين ممكن يكون إلها مكان بيومك؟" });
  revalidatePath("/app/mirror", "layout");
  return { ok: true };
}

/** ط.2: قبول/رفض اقتراح أسبوع المرآة (الرفض يمنع التكرار 30 يومًا). */
export async function decideMirrorSuggestionAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ id: z.string().uuid(), accept: z.enum(["true", "false"]) }).safeParse({ id: form.get("id"), accept: form.get("accept") });
  if (!p.success) return { ok: false, error: "invalid_input" };
  if (!(await owner())) return { ok: false, error: "not_allowed" };
  const { error } = await (await createClient()).rpc("decide_mirror_suggestion", { p_id: p.data.id, p_accept: p.data.accept === "true" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/mirror", "layout");
  if (p.data.accept === "true") redirect("/app/mirror/reconstruct?date=yesterday");
  return { ok: true };
}
