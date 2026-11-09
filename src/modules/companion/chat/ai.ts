/**
 * طبقة الذكاء الاصطناعي للمحادثة الحرة (0.5 RULES-2): استدعاء النموذج وتسجيله في ai_calls فقط.
 * كل الكتابات الأخرى (الرسائل، الجلسة، المؤشرات، الأدلة، طلب المربي، اقتراحات السياق) يقررها المنسّق chat/service.ts بالقواعد.
 * RULES-4: في companion_chat يُسجَّل خرق حارس الأرقام فقط (لا يُمنع).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ai } from "@/shared/config";
import type { ModelCaller, ModelRequest } from "../model";
import { runFunction } from "../runtime";
import { FUNCTION_INSTRUCTIONS, PROMPT_VERSION } from "../prompts";
import { companionChatAnalysis, type CompanionChatAnalysis } from "../schemas";
import { aiHealth, providerErrorMeta } from "@/lib/ai/health";
import { guardText } from "@/lib/ai/text-guard";

export type ChatReply = { ok: true; reply: string; modelId: string; usage: { input: number; output: number; cacheRead: number }; t0: number } | { ok: false; reason: "disabled" | "error" };

/** هل المرافق متاح الآن؟ (العلم + التدهور التلقائي) */
export async function chatAvailable(admin: SupabaseClient, caller: ModelCaller, now: Date): Promise<boolean> {
  return caller.enabled && !(await aiHealth(admin, now)).degraded;
}

export async function streamChatReply(admin: SupabaseClient, caller: ModelCaller, profileId: string, req: ModelRequest, onText?: (t: string) => void): Promise<ChatReply> {
  const t0 = Date.now();
  try {
    const r = caller.stream ? await caller.stream(req, onText ?? (() => {})) : await caller.call(req);
    return { ok: true, reply: r.text.trim(), modelId: r.modelId, usage: r.usage, t0 };
  } catch (e) {
    await admin.from("ai_calls").insert({ profile_id: profileId, function: "companion_chat", prompt_version: PROMPT_VERSION, model_id: caller.modelId(req.model), input_hash: "stream", valid: false, error: (e as Error).message, latency_ms: Date.now() - t0, meta: providerErrorMeta(e) });
    return { ok: false, reason: "error" };
  }
}

/** تسجيل الرد النهائي، مع خرق حارس الأرقام إن وُجد (تسجيل فقط في المحادثة الحرة). */
export async function logChatReply(admin: SupabaseClient, profileId: string, r: Extract<ChatReply, { ok: true }>, finalText: string, replaced: boolean, inputText: string): Promise<{ guardViolations: string[] }> {
  const g = ai.text_guard.companion_chat === "log_only" ? guardText([finalText], inputText) : { ok: true as const };
  const guardViolations = g.ok ? [] : g.violations;
  await admin.from("ai_calls").insert({ profile_id: profileId, function: "companion_chat", prompt_version: PROMPT_VERSION, model_id: r.modelId, input_hash: "stream", valid: !replaced, tokens_in: r.usage.input, tokens_out: r.usage.output, cache_read_tokens: r.usage.cacheRead, latency_ms: Date.now() - r.t0, output: { replaced }, meta: guardViolations.length ? { text_guard_violations: guardViolations, text_guard_mode: "log_only" } : null });
  return { guardViolations };
}

/** التحليل المهيكل (AI-3، AI-12): مرشحات فقط؛ المنسّق يقرر ما يُحفظ. */
export async function analyzeChatTurn(admin: SupabaseClient, caller: ModelCaller, profileId: string, mode: string, text: string, reply: string): Promise<CompanionChatAnalysis | null> {
  const r = await runFunction({ db: admin, caller, fn: "companion_chat", profileId, system: FUNCTION_INSTRUCTIONS.companion_chat_analysis, dynamicSystem: `الوضع العمري: ${mode}`, messages: [{ role: "user", content: `رسالة المستخدم: ${text}\nرد المرافق: ${reply}` }], schema: companionChatAnalysis });
  return r.ok ? r.data : null;
}
