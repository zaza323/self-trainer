"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { showMemoryInPlanning, recallLine } from "@/modules/adaptation";
import { loadStrategyOutcomes, strategyLabelFor } from "@/modules/adaptation/service";
import type { MissionTemplate } from "@/modules/library";
import type { SupportLevel } from "@/shared/config";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { limits, type AgeMode } from "@/shared/config";
import { getSession } from "@/modules/accounts";
import { getMission } from "@/modules/missions";
import { evaluateAndRecord } from "@/modules/evidence";
import { afterMissionReflected } from "@/modules/game";
import { evaluateRewardTriggers } from "@/modules/rewards";
import { scheduleTransferInvite } from "@/modules/life";
import { textByMode } from "@/modules/library";
import { anthropicCaller } from "./model";
import { getOrCreateSession, handlePlayerMessage, requestHuman } from "./chat/service";
import { goalBuilderTurn } from "./functions/goal-builder";
import { reflectionCoachTurn } from "./functions/reflection-coach";
import { buildChatContext } from "./context";
import type { GoalBuilderOutput, ReflectionCoachOutput } from "./schemas";
import fixedQuestions from "@content/fixed_questions.ar.json";

export type CompanionActionResult = { ok: true; data?: unknown } | { ok: false; error: string };
const uuid = z.string().uuid();

async function owner() {
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return null;
  return { session: s, profile: s.profile, mode: s.profile.age_mode as AgeMode };
}

/** AI-1: إرسال رسالة (المسار غير المبثوث؛ المسار المبثوث في /api/companion/stream). */
export async function sendChatMessage(_: unknown, form: FormData): Promise<CompanionActionResult> {
  const p = z.object({ text: z.string().trim().min(1).max(2000), mode: z.enum(["free", "comeback"]).default("free") }).safeParse({ text: form.get("text"), mode: form.get("mode") ?? "free" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const sess = await getOrCreateSession(db, o.profile.id, p.data.mode);
  const { data: m, error } = await db.from("companion_messages").insert({ session_id: sess.id, role: "player", author_id: o.session.userId, content: p.data.text }).select("id").single();
  if (error || !m) return { ok: false, error: "not_allowed" };
  const admin = createAdminClient();
  const ctx = await buildChatContext(admin, { id: o.profile.id, age_mode: o.mode });
  const r = await handlePlayerMessage(admin, anthropicCaller(), ctx, sess.id, m.id as string, p.data.text);
  revalidatePath("/app/chat");
  return { ok: true, data: r };
}

/** AI-13: زر "أريد أن أتحدث مع [المربي]" */
export async function askForGuardian(_: unknown, form: FormData): Promise<CompanionActionResult> {
  const sessionId = String(form.get("session_id"));
  if (!uuid.safeParse(sessionId).success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const r = await requestHuman(createAdminClient(), o.profile.id, sessionId, null, "player", null);
  revalidatePath("/app/chat");
  return { ok: true, data: r };
}

/** G03: المربي يتدخل / يعيد الكلمة / يكتب (RLS تفرض intervene_chat). */
export async function guardianChat(_: unknown, form: FormData): Promise<CompanionActionResult> {
  const p = z.object({ session_id: uuid, action: z.enum(["intervene", "hand_back", "send"]), text: z.string().trim().max(2000).optional().or(z.literal("")) }).safeParse({ session_id: form.get("session_id"), action: form.get("action"), text: form.get("text") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const s = await getSession();
  if (!s) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  if (p.data.action === "intervene") {
    const { data } = await db.from("companion_sessions").update({ handoff: "guardian", handoff_guardian_id: s.userId, handoff_at: new Date().toISOString() }).eq("id", p.data.session_id).select("id");
    if (!data?.length) return { ok: false, error: "not_allowed" };
    await createAdminClient().from("companion_messages").insert({ session_id: p.data.session_id, role: "system", content: "handoff_guardian", meta: { guardian_id: s.userId, name: s.profile?.display_name ?? "" } });
  } else if (p.data.action === "hand_back") {
    const { data } = await db.from("companion_sessions").update({ handoff: "ai", handoff_guardian_id: null, handoff_at: null }).eq("id", p.data.session_id).select("id");
    if (!data?.length) return { ok: false, error: "not_allowed" };
    await createAdminClient().from("companion_messages").insert({ session_id: p.data.session_id, role: "system", content: "handoff_back", meta: {} });
  } else {
    if (!p.data.text) return { ok: false, error: "invalid_input" };
    const { error } = await db.from("companion_messages").insert({ session_id: p.data.session_id, role: "guardian", author_id: s.userId, content: p.data.text, meta: { name: s.profile?.display_name ?? "" } });
    if (error) return { ok: false, error: "not_allowed" };
    await db.from("human_requests").update({ resolved_by: s.userId, resolved_at: new Date().toISOString() }).eq("session_id", p.data.session_id).is("resolved_at", null);
  }
  revalidatePath("/guardian", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// P02 بالذكاء الاصطناعي: بناء الغاية حوارًا مع مسودة حية (GOAL-2، AI-16)
// ---------------------------------------------------------------------------
export type GoalDialogState = { sessionId: string; turn: number; output: GoalBuilderOutput; source: "ai" | "fixed"; history: Array<{ role: "user" | "assistant"; content: string }> };

export async function goalDialogTurn(_: unknown, form: FormData): Promise<CompanionActionResult> {
  const p = z.object({ text: z.string().trim().max(1000).default("") }).safeParse({ text: form.get("text") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const sess = await getOrCreateSession(db, o.profile.id, "goal");
  const { data: hist } = await db.from("companion_messages").select("role, content").eq("session_id", sess.id).order("created_at");
  const history = ((hist ?? []) as Array<{ role: string; content: string }>).filter((m) => m.role !== "system").map((m) => ({ role: m.role === "ai" ? ("assistant" as const) : ("user" as const), content: m.content }));
  const turn = history.filter((m) => m.role === "user").length + (p.data.text ? 1 : 0);
  const { data: sessRow } = await db.from("companion_sessions").select("draft").eq("id", sess.id).single();
  const draft = (sessRow?.draft as GoalBuilderOutput["draft"] | null) ?? null;
  if (p.data.text) await db.from("companion_messages").insert({ session_id: sess.id, role: "player", author_id: o.session.userId, content: p.data.text });
  const admin = createAdminClient();
  const r = await goalBuilderTurn({ db: admin, caller: anthropicCaller(), profileId: o.profile.id, mode: o.mode, history, userMessage: p.data.text || "(بداية)", draft, turn });
  const aiText = r.output.next_question ?? (r.output.needs_user_confirmation ? "راجع المسودة وأكدها أو عدّلها بكلماتك." : "");
  if (aiText) await admin.from("companion_messages").insert({ session_id: sess.id, role: "ai", content: aiText, meta: { phase: r.output.phase, thinking_move: r.output.thinking_move_named, source: r.source } });
  await admin.from("companion_sessions").update({ draft: r.output.draft, turn_count: turn }).eq("id", sess.id);
  const state: GoalDialogState = { sessionId: sess.id, turn, output: r.output, source: r.source, history: [...history, ...(p.data.text ? [{ role: "user" as const, content: p.data.text }] : []), ...(aiText ? [{ role: "assistant" as const, content: aiText }] : [])] };
  return { ok: true, data: state };
}

/** AI-16/أ.1: ما يُحفظ هو نص المسودة بعد تعديل المستخدم، لا مخرج النموذج. */
export async function confirmGoalDraft(_: unknown, form: FormData): Promise<CompanionActionResult> {
  const titles = form.getAll("title").map((t) => String(t).trim());
  const whys = form.getAll("why").map((w) => String(w).trim());
  const parents = form.getAll("parent").map((p) => String(p));
  const firstStep = String(form.get("first_step") ?? "").trim();
  const sessionId = String(form.get("session_id") ?? "");
  if (titles.length === 0 || titles.some((t) => !t || t.length > 200) || titles.length + 1 > limits.goal_max_depth) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const idByIndex = new Map<number, string>();
  // الحفظ من الجذور نزولًا: الأب يُحفظ قبل أبنائه
  const order = [...titles.keys()].sort((a, b) => depthOf(a, parents) - depthOf(b, parents));
  let leaf: string | null = null;
  for (const i of order) {
    const parentIdx = parents[i] === "" ? -1 : Number(parents[i]);
    const { data, error } = await db.from("goals").insert({ profile_id: o.profile.id, parent_goal_id: parentIdx >= 0 ? idByIndex.get(parentIdx) ?? null : null, title: titles[i], why: whys[i] || null }).select("id").single();
    if (error) return { ok: false, error: error.message };
    idByIndex.set(i, data.id as string);
    leaf = data.id as string;
  }
  if (firstStep) {
    const { error } = await db.from("goals").insert({ profile_id: o.profile.id, parent_goal_id: idByIndex.get(0) ?? leaf, title: firstStep, why: titles[0] ? `خطوة أولى نحو: ${titles[0]}` : null });
    if (error) return { ok: false, error: error.message };
  }
  if (uuid.safeParse(sessionId).success) await db.from("companion_sessions").update({ ended_at: new Date().toISOString(), summary: `غاية: ${titles[0]}` }).eq("id", sessionId);
  revalidatePath("/app", "layout");
  redirect("/app");
}
function depthOf(i: number, parents: string[]): number { let d = 0, cur = i; const seen = new Set<number>(); while (parents[cur] !== "" && parents[cur] !== undefined && !seen.has(cur)) { seen.add(cur); cur = Number(parents[cur]); d++; if (d > 20) break; } return d; }

// ---------------------------------------------------------------------------
// P09 بالذكاء الاصطناعي: التأمل حوارًا (reflection_coach) مع سقوط إلى الأسئلة الثابتة
// ---------------------------------------------------------------------------
/** 4.13.2: عند L2–L3 يستحضر المرافق ذاكرة الاستراتيجيات في التأمل فقط. */
async function reflectionRecall(db: Awaited<ReturnType<typeof createClient>>, profileId: string, template: MissionTemplate, support: SupportLevel, mode: AgeMode): Promise<string | null> {
  if (showMemoryInPlanning(support)) return null;
  const rows = await loadStrategyOutcomes(db, profileId);
  return recallLine(rows, template.mechanic, mode, (k) => strategyLabelFor(k, template.strategies, mode, rows));
}

export type ReflectionDialogState = { sessionId: string; turn: number; output: ReflectionCoachOutput; source: "ai" | "fixed"; history: Array<{ role: "user" | "assistant"; content: string }> };

export async function reflectionDialogTurn(_: unknown, form: FormData): Promise<CompanionActionResult> {
  const p = z.object({ mission_id: uuid, text: z.string().trim().max(1500).default("") }).safeParse({ mission_id: form.get("mission_id"), text: form.get("text") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const o = await owner();
  if (!o) return { ok: false, error: "not_allowed" };
  const found = await getMission(p.data.mission_id);
  if (!found || found.mission.profile_id !== o.profile.id || !["completed", "abandoned"].includes(found.mission.status)) return { ok: false, error: "bad_state" };
  const { mission, template } = found;
  const db = await createClient();
  const sess = await getOrCreateSession(db, o.profile.id, "reflect", mission.id);
  const { data: hist } = await db.from("companion_messages").select("role, content").eq("session_id", sess.id).order("created_at");
  const history = ((hist ?? []) as Array<{ role: string; content: string }>).filter((m) => m.role !== "system").map((m) => ({ role: m.role === "ai" ? ("assistant" as const) : ("user" as const), content: m.content }));
  const turn = history.filter((m) => m.role === "user").length + (p.data.text ? 1 : 0);
  if (p.data.text) await db.from("companion_messages").insert({ session_id: sess.id, role: "player", author_id: o.session.userId, content: p.data.text });
  const admin = createAdminClient();
  const fixedPrompts = [...(mission.status === "abandoned" ? fixedQuestions.reflection_after_abandon[o.mode] : []), ...template.reflection_prompts.map((q) => textByMode(q, o.mode)), ...fixedQuestions.reflection_general[o.mode]];
  const facts = { gate1: mission.gate1, strategy: mission.strategy_chosen, custom_strategy: mission.custom_strategy, prediction: mission.prediction, actual_duration_min: mission.actual_duration_min, hints_used: mission.hints_used, distractions: mission.distraction_log.map((d) => d.choice), interrupted: mission.interruption_reasons.length > 0 };
  const strategyRecall = await reflectionRecall(db, o.profile.id, template, mission.support_level, o.mode);
  const r = await reflectionCoachTurn({ db: admin, caller: anthropicCaller(), profileId: o.profile.id, mode: o.mode, support: mission.support_level, template, missionFacts: facts, history, userMessage: p.data.text || "(بداية التأمل)", turn: Math.max(turn, p.data.text ? turn : 0), customStrategy: mission.custom_strategy, fixedPrompts, strategyRecall });
  if (r.output.next_question) await admin.from("companion_messages").insert({ session_id: sess.id, role: "ai", content: r.output.next_question, meta: { source: r.source } });
  if (r.output.done) {
    // حفظ التأمل من الخيط، ثم reflected، ثم التقييم بمرشحات ai (أ.1) وfit المخصصة
    const qa: Array<{ prompt: string; answer: string }> = [];
    const all = [...history, ...(p.data.text ? [{ role: "user" as const, content: p.data.text }] : [])];
    for (let i = 0; i < all.length; i++) if (all[i]!.role === "assistant" && all[i + 1]?.role === "user") qa.push({ prompt: all[i]!.content, answer: all[i + 1]!.content });
    if (qa.length === 0 && p.data.text) qa.push({ prompt: fixedPrompts[0] ?? "", answer: p.data.text });
    const { error } = await db.from("reflections").insert({ mission_id: mission.id, prompts_and_answers: qa, summary: r.output.reflection_summary_user_words });
    if (error && !/duplicate key/.test(error.message)) return { ok: false, error: error.message };
    const { error: tErr } = await db.rpc("transition_mission", { p_mission_id: mission.id, p_to: "reflected", p_meta: { via: "reflection_coach", source: r.source } });
    if (tErr && !/not allowed/.test(tErr.message)) return { ok: false, error: tErr.message };
    try {
      await evaluateAndRecord(admin, mission.id, { customStrategyFit: r.output.custom_strategy_fit, candidates: r.output.evidence_candidates });
      await afterMissionReflected(admin, mission.id);
      await evaluateRewardTriggers(admin, o.profile.id);
      await scheduleTransferInvite(admin, o.profile.id, mission.id, template.training_level);
    } catch (e) { console.error("evaluation failed", e); }
    await admin.from("companion_sessions").update({ ended_at: new Date().toISOString(), summary: r.output.reflection_summary_user_words }).eq("id", sess.id);
    revalidatePath("/app", "layout");
    redirect(`/app/missions/${mission.id}`);
  }
  const state: ReflectionDialogState = { sessionId: sess.id, turn, output: r.output, source: r.source, history: [...history, ...(p.data.text ? [{ role: "user" as const, content: p.data.text }] : []), ...(r.output.next_question ? [{ role: "assistant" as const, content: r.output.next_question }] : [])] };
  return { ok: true, data: state };
}
