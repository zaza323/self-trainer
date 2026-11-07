import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ai, limits, CONFIG_VERSION, type AgeMode, type SupportLevel } from "@/shared/config";
import { evidenceWeight } from "@/modules/evidence";
import { effective } from "@/modules/settings";
import { classifyText, safeResponse, raiseSafetyFlag } from "@/modules/safety";
import type { ModelCaller } from "../model";
import { runFunction } from "../runtime";
import { personaSystem, supportStyle, FUNCTION_INSTRUCTIONS, PROMPT_VERSION } from "../prompts";
import { companionChatAnalysis, questionMarks } from "../schemas";
import messagesContent from "@content/companion_messages.ar.json";

/**
 * المحادثة الحرة (AI-1..AI-14): خيط واحد مشترك بين المتدرب ومربيه. الرد يُبث نصًا ثم يُحلَّل بوظيفة خفيفة مهيكلة.
 * كل الكتابات الآلية بعميل الخدمة (admin)؛ رسالة المتدرب تُدرج بعميله هو (RLS).
 */
export type ChatMode = "free" | "goal" | "plan" | "reflect" | "comeback" | "review" | "daily_moment" | "mirror" | "weekly_review";

export type ChatContext = {
  profileId: string; mode: AgeMode; support: SupportLevel;
  viewers: Array<{ name: string; relation: string }>;
  memory: { insights: string[]; lastSummary: string | null; personalContext: Record<string, unknown> | null };
};

export async function getOrCreateSession(userDb: SupabaseClient, profileId: string, mode: ChatMode, missionId: string | null = null): Promise<{ id: string; handoff: "ai" | "guardian"; handoff_guardian_id: string | null; turn_count: number }> {
  const { data: open } = await userDb.from("companion_sessions").select("id, handoff, handoff_guardian_id, turn_count").eq("profile_id", profileId).eq("mode", mode).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
  const found = (open ?? [])[0] as { id: string; handoff: "ai" | "guardian"; handoff_guardian_id: string | null; turn_count: number } | undefined;
  if (found) return found;
  const { data, error } = await userDb.from("companion_sessions").insert({ profile_id: profileId, mode, mission_id: missionId }).select("id, handoff, handoff_guardian_id, turn_count").single();
  if (error) throw error;
  return data as { id: string; handoff: "ai" | "guardian"; handoff_guardian_id: string | null; turn_count: number };
}

/** AI-9: حد المحادثة الحرة اليومي (دقائق) في child — يُحسب من رسائل اليوم (كل رسالة متدرب = دقيقة تقريبًا حتى المرحلة 6). */
export async function chatMinutesToday(admin: SupabaseClient, profileId: string, now = new Date()): Promise<number> {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const { data: sessions } = await admin.from("companion_sessions").select("id").eq("profile_id", profileId).eq("mode", "free");
  const ids = ((sessions ?? []) as Array<{ id: string }>).map((s) => s.id);
  if (ids.length === 0) return 0;
  const { data: msgs } = await admin.from("companion_messages").select("id").in("session_id", ids).eq("role", "player").gte("created_at", start.toISOString());
  return (msgs ?? []).length;
}

/** AI-11: يُعاد الكلام للمرافق تلقائيًا بعد N دقيقة بلا رسائل من المربي. */
export async function releaseStaleHandoff(admin: SupabaseClient, sessionId: string, now = new Date()): Promise<boolean> {
  const { data: s } = await admin.from("companion_sessions").select("handoff, handoff_guardian_id, handoff_at").eq("id", sessionId).single();
  if (!s || s.handoff !== "guardian") return false;
  const { data: last } = await admin.from("companion_messages").select("created_at").eq("session_id", sessionId).eq("role", "guardian").order("created_at", { ascending: false }).limit(1);
  const lastAt = ((last ?? [])[0]?.created_at as string | undefined) ?? (s.handoff_at as string | null);
  if (!lastAt) return false;
  if (now.getTime() - new Date(lastAt).getTime() < limits.chat.handoff_release_minutes * 60000) return false;
  await admin.from("companion_sessions").update({ handoff: "ai", handoff_guardian_id: null, handoff_at: null }).eq("id", sessionId);
  await admin.from("companion_messages").insert({ session_id: sessionId, role: "system", content: "handoff_back", meta: {} });
  return true;
}

export function disclosureLine(viewers: ChatContext["viewers"]): string {
  const m = messagesContent;
  const v = viewers.length ? m.viewers_some.replace("{names}", viewers.map((x) => `${x.name} (${x.relation})`).join("، ")) : m.viewers_none;
  return m.ai_disclosure.replace("{viewers}", v);
}

export type ChatResult =
  | { kind: "reply"; messageId: string; text: string; needsHuman: boolean }
  | { kind: "safety"; messageId: string; text: string; category: string }
  | { kind: "limit"; text: string }
  | { kind: "handoff"; text: string }
  | { kind: "fallback"; messageId: string; text: string };

/**
 * معالجة رسالة متدرب (مُدرجة سلفًا بعميله). يبث الرد عبر onText ثم يحفظه ويحلّله.
 */
export async function handlePlayerMessage(admin: SupabaseClient, caller: ModelCaller, ctx: ChatContext, sessionId: string, playerMessageId: string, text: string, onText?: (t: string) => void, now = new Date()): Promise<ChatResult> {
  // 1) الأمان الوارد (7.4)
  const inbound = await classifyText(admin, caller, ctx.profileId, text, "inbound");
  if (inbound.safety.flag && inbound.safety.category) {
    const reply = safeResponse(inbound.safety.category, ctx.mode);
    const { data: m } = await admin.from("companion_messages").insert({ session_id: sessionId, role: "ai", content: reply, safety_flagged: true, meta: { safety: inbound.safety, persona_paused: true } }).select("id").single();
    await admin.from("companion_messages").update({ safety_flagged: true }).eq("id", playerMessageId);
    await raiseSafetyFlag(admin, { profileId: ctx.profileId, sessionId, messageId: playerMessageId, direction: "inbound", verdict: inbound });
    onText?.(reply);
    return { kind: "safety", messageId: m!.id as string, text: reply, category: inbound.safety.category };
  }
  // 2) handoff للمربي (AI-11): المرافق لا يُستدعى
  await releaseStaleHandoff(admin, sessionId, now);
  const { data: sess } = await admin.from("companion_sessions").select("handoff, mode, turn_count").eq("id", sessionId).single();
  if (sess?.handoff === "guardian") return { kind: "handoff", text: messagesContent.handoff_guardian.replace("{name}", "المربي") };
  // 3) حد المحادثة الحرة (AI-9)
  if (sess?.mode === "free") {
    const limitMin = (await effective<number | null>(admin, ctx.profileId, "companion_free_chat_daily_minutes")).value;
    if (limitMin !== null && (await chatMinutesToday(admin, ctx.profileId, now)) > limitMin) {
      const t = messagesContent.limit_reached[ctx.mode];
      onText?.(t);
      return { kind: "limit", text: t };
    }
  }
  // 4) السياق (AI-7): مؤشرات + ملخص آخر محادثة + سياق الحياة + من يرى + مستوى الدعم؛ رسائل المربين تدخل السياق (AI-14)
  const { data: hist } = await admin.from("companion_messages").select("role, content, created_at").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(limits.chat.context_messages);
  const history = ((hist ?? []) as Array<{ role: string; content: string }>).reverse().filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "ai" ? ("assistant" as const) : ("user" as const), content: m.role === "guardian" ? `[رسالة من المربي]: ${m.content}` : m.content }));
  if (history.length === 0 || history[history.length - 1]!.content !== text) history.push({ role: "user", content: text });
  // دمج الرسائل المتتالية من الدور نفسه (متطلب API)
  const merged: typeof history = [];
  for (const m of history) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += `\n${m.content}`; else merged.push({ ...m }); }
  if (merged[0]?.role === "assistant") merged.unshift({ role: "user", content: "(بداية المحادثة)" });
  const dynamic = [supportStyle(ctx.support), `من يرى المحادثة: ${ctx.viewers.map((v) => `${v.name} (${v.relation})`).join("، ") || "لا أحد غير المستخدم"}`,
    ctx.memory.lastSummary ? `ملخص آخر محادثة: ${ctx.memory.lastSummary}` : "", ctx.memory.insights.length ? `مؤشرات التعلم: ${ctx.memory.insights.join("؛ ")}` : "",
    ctx.memory.personalContext ? `سياق الحياة: ${JSON.stringify(ctx.memory.personalContext)}` : "", "أجب نصًا عاديًا (لا JSON) بسؤال واحد كحد أقصى."].filter(Boolean).join("\n");
  const cfg = ai.functions.companion_chat;
  const limitReached = (await countCalls(admin, "companion_chat", ctx.profileId, now)) >= (cfg.daily_calls_per_profile ?? Number.MAX_SAFE_INTEGER);
  if (!caller.enabled || limitReached) {
    const t = limitReached ? messagesContent.limit_reached[ctx.mode] : messagesContent.apology_fallback;
    const { data: m } = await admin.from("companion_messages").insert({ session_id: sessionId, role: "ai", content: t, meta: { fallback: limitReached ? "limit" : "disabled" } }).select("id").single();
    onText?.(t);
    return { kind: "fallback", messageId: m!.id as string, text: t };
  }
  // 5) الرد المبثوث
  const system = personaSystem(ctx.mode, { jsonContract: false });
  const t0 = Date.now();
  let reply = "", modelId = caller.modelId("main"), usage = { input: 0, output: 0, cacheRead: 0 };
  try {
    const req = { model: "main" as const, system, dynamicSystem: dynamic, messages: merged, maxOutputTokens: cfg.max_output_tokens };
    const r = caller.stream ? await caller.stream(req, onText ?? (() => {})) : await caller.call(req);
    reply = r.text.trim(); modelId = r.modelId; usage = r.usage;
  } catch (e) {
    await admin.from("ai_calls").insert({ profile_id: ctx.profileId, function: "companion_chat", prompt_version: PROMPT_VERSION, model_id: modelId, input_hash: "stream", valid: false, error: (e as Error).message, latency_ms: Date.now() - t0 });
    const t = messagesContent.apology_fallback;
    const { data: m } = await admin.from("companion_messages").insert({ session_id: sessionId, role: "ai", content: t, meta: { fallback: "error" } }).select("id").single();
    onText?.(t);
    return { kind: "fallback", messageId: m!.id as string, text: t };
  }
  // AI-15: سؤال واحد كحد أقصى؛ الأمان الصادر
  let replaced = false;
  if (questionMarks(reply) > ai.validation.max_questions_per_reply) { reply = reply.split(/(?<=[؟?])/).slice(0, 1).join("").trim() || reply; replaced = true; }
  const outbound = await classifyText(admin, caller, ctx.profileId, reply, "outbound");
  if (outbound.safety.flag && outbound.safety.category) { reply = safeResponse(outbound.safety.category, ctx.mode); replaced = true; }
  await admin.from("ai_calls").insert({ profile_id: ctx.profileId, function: "companion_chat", prompt_version: PROMPT_VERSION, model_id: modelId, input_hash: "stream", valid: !replaced, tokens_in: usage.input, tokens_out: usage.output, cache_read_tokens: usage.cacheRead, latency_ms: Date.now() - t0, output: { replaced } });
  const { data: saved } = await admin.from("companion_messages").insert({ session_id: sessionId, role: "ai", content: reply, meta: { replaced } }).select("id").single();
  const messageId = saved!.id as string;
  if (outbound.safety.flag) await raiseSafetyFlag(admin, { profileId: ctx.profileId, sessionId, messageId, direction: "outbound", verdict: outbound });
  await admin.from("companion_sessions").update({ turn_count: (sess?.turn_count ?? 0) + 1 }).eq("id", sessionId);

  // 6) التحليل المهيكل (AI-3، AI-12، ADAPT-2)
  let needsHuman = false;
  const analysis = await runFunction({ db: admin, caller, fn: "companion_chat", profileId: ctx.profileId, system: FUNCTION_INSTRUCTIONS.companion_chat_analysis,
    dynamicSystem: `الوضع العمري: ${ctx.mode}`, messages: [{ role: "user", content: `رسالة المستخدم: ${text}\nرد المرافق: ${reply}` }], schema: companionChatAnalysis });
  if (analysis.ok) {
    const a = analysis.data;
    if (a.insights.length) {
      await admin.from("companion_insights").insert(a.insights.map((i) => ({ session_id: sessionId, profile_id: ctx.profileId, capability_id: i.capability_id, type: i.type, value: i.value, confidence: i.confidence })));
      // دليل بوزن منخفض خارج المهام (4.7: companion_insight، المصدر companion)
      await admin.from("evidence_events").insert(a.insights.map((i) => ({ profile_id: ctx.profileId, mission_id: null, capability_id: i.capability_id, rule_id: "companion", source: "companion", type: "companion_insight", value: i.value, rule_weight: i.confidence, weight: evidenceWeight("companion", ctx.support, i.confidence), context_tag: "chat", support_level: ctx.support, config_version: CONFIG_VERSION })));
    }
    if (a.needs_human.flag) { needsHuman = true; await requestHuman(admin, ctx.profileId, sessionId, messageId, "ai", a.needs_human.reason); }
    if (a.context_suggestion) await admin.from("context_suggestions").insert({ profile_id: ctx.profileId, session_id: sessionId, field: a.context_suggestion.field, value: a.context_suggestion.value });
  }
  return { kind: "reply", messageId, text: reply, needsHuman };
}

async function countCalls(admin: SupabaseClient, fn: string, profileId: string, now: Date) {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const { data } = await admin.from("ai_calls").select("id").eq("function", fn).eq("profile_id", profileId).gte("created_at", start.toISOString());
  return (data ?? []).length;
}

/** AI-12/AI-13: طلب إنسان → human_requests + إشعار لكل مربٍ لديه intervene_chat + رد ثابت في الخيط. */
export async function requestHuman(admin: SupabaseClient, profileId: string, sessionId: string, messageId: string | null, requestedBy: "ai" | "player", reason: string | null): Promise<{ notified: number; text: string }> {
  const { data: links } = await admin.from("guardian_links").select("guardian_id, permissions").eq("player_id", profileId).eq("status", "active");
  const ids = ((links ?? []) as Array<{ guardian_id: string; permissions: Record<string, boolean> }>).filter((l) => l.permissions.intervene_chat).map((l) => l.guardian_id);
  await admin.from("human_requests").insert({ session_id: sessionId, message_id: messageId, requested_by: requestedBy, reason, notified_guardian_ids: ids });
  for (const g of ids) await admin.from("notifications").insert({ profile_id: profileId, type: "human_requested", payload: { session_id: sessionId, guardian_id: g, requested_by: requestedBy, reason } });
  const text = ids.length ? messagesContent.needs_human_reply : messagesContent.needs_human_no_guardian;
  await admin.from("companion_messages").insert({ session_id: sessionId, role: "ai", content: text, needs_human: true, meta: { requested_by: requestedBy } });
  return { notified: ids.length, text };
}
