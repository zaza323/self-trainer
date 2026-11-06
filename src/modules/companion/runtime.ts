/**
 * تشغيل وظيفة مهيكلة (7.2/7.3): حدود يومية من config/ai.json، استدعاء، تحقق Zod، إعادة محاولة مرة، ثم سلوك ثابت.
 * كل مخرج يُسجَّل في ai_calls مع prompt_version وmodel_id. لا يصل أي مخرج غير متحقق إلى قاعدة البيانات.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { createHash } from "node:crypto";
import { ai } from "@/shared/config";
import type { ModelCaller, ModelRequest } from "./model";
import { PROMPT_VERSION } from "./prompts";

export type FunctionKey = keyof typeof ai.functions;
export type RunResult<T> = { ok: true; data: T; modelId: string } | { ok: false; reason: "disabled" | "limit" | "invalid" | "error"; detail?: string };

export type RunArgs<S extends z.ZodTypeAny> = {
  db: SupabaseClient;              // service_role (لكتابة ai_calls)
  caller: ModelCaller;
  fn: FunctionKey | "safety_classifier";
  profileId: string | null;
  system: string;
  dynamicSystem?: string;
  messages: ModelRequest["messages"];
  schema: S;
  /** تحقق إضافي بعد Zod (قواعد الخادم)؛ يعيد رسالة الخطأ أو null */
  verify?: (data: z.infer<S>) => string | null;
  /** بيانات إضافية تُسجَّل في ai_calls.meta للمخرج الصالح (مثل استبدال شكل الرد، 0.4 أ.7) */
  meta?: (data: z.infer<S>) => Record<string, unknown> | null;
  now?: Date;
};

function fnConfig(fn: RunArgs<never>["fn"]) {
  if (fn === "safety_classifier") return { model: "light" as const, max_output_tokens: 120, daily_calls_per_profile: Number.MAX_SAFE_INTEGER };
  const c = ai.functions[fn] as { model: "main" | "light"; max_output_tokens: number; daily_calls_per_profile?: number; daily_calls_global?: number };
  return { model: c.model, max_output_tokens: c.max_output_tokens, daily_calls_per_profile: c.daily_calls_per_profile ?? Number.MAX_SAFE_INTEGER, daily_calls_global: c.daily_calls_global };
}

export async function callsToday(db: SupabaseClient, fn: string, profileId: string | null, now = new Date()): Promise<number> {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  let q = db.from("ai_calls").select("id").eq("function", fn).gte("created_at", start.toISOString());
  if (profileId) q = q.eq("profile_id", profileId);
  const { data } = await q;
  return (data ?? []).length;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { /* نحاول أول كائن */ }
  const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; } }
  return null;
}

export async function runFunction<S extends z.ZodTypeAny>(a: RunArgs<S>): Promise<RunResult<z.infer<S>>> {
  const cfg = fnConfig(a.fn);
  const now = a.now ?? new Date();
  if (!a.caller.enabled) return { ok: false, reason: "disabled" };
  const used = await callsToday(a.db, a.fn, cfg.daily_calls_global ? null : a.profileId, now);
  if (used >= (cfg.daily_calls_global ?? cfg.daily_calls_per_profile)) return { ok: false, reason: "limit" };

  const inputHash = createHash("sha256").update(JSON.stringify({ s: a.system, d: a.dynamicSystem, m: a.messages })).digest("hex").slice(0, 32);
  const retries = ai.validation.retries_on_invalid;
  let messages = a.messages;
  let lastError = "";
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const t0 = Date.now();
    let text = "", modelId = a.caller.modelId(cfg.model), usage = { input: 0, output: 0, cacheRead: 0 };
    try {
      const r = await a.caller.call({ model: cfg.model, system: a.system, dynamicSystem: a.dynamicSystem, messages, maxOutputTokens: cfg.max_output_tokens });
      text = r.text; modelId = r.modelId; usage = r.usage;
    } catch (e) {
      await a.db.from("ai_calls").insert({ profile_id: a.profileId, function: a.fn, prompt_version: PROMPT_VERSION, model_id: modelId, input_hash: inputHash, valid: false, attempt, error: (e as Error).message, latency_ms: Date.now() - t0 });
      return { ok: false, reason: "error", detail: (e as Error).message };
    }
    const json = extractJson(text);
    const parsed = a.schema.safeParse(json);
    const verifyError = parsed.success ? (a.verify?.(parsed.data) ?? null) : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    const valid = parsed.success && !verifyError;
    await a.db.from("ai_calls").insert({ profile_id: a.profileId, function: a.fn, prompt_version: PROMPT_VERSION, model_id: modelId, input_hash: inputHash, output: valid ? parsed.data : null, valid, attempt, tokens_in: usage.input, tokens_out: usage.output, cache_read_tokens: usage.cacheRead, latency_ms: Date.now() - t0, error: valid ? null : (verifyError ?? "invalid_json"), meta: valid ? (a.meta?.(parsed.data) ?? null) : null });
    if (valid) return { ok: true, data: parsed.data, modelId };
    lastError = verifyError ?? "invalid_json";
    messages = [...messages, { role: "assistant", content: text.slice(0, 2000) || "{}" }, { role: "user", content: `المخرج السابق مرفوض (${lastError}). أعد الإخراج كـ JSON صالح يطابق المخطط حرفيًا، بسؤال واحد كحد أقصى.` }];
  }
  return { ok: false, reason: "invalid", detail: lastError };
}

/** مستدعٍ وهمي للاختبارات الثابتة. */
export function fakeCaller(responses: Array<string | (() => string)>, opts: { enabled?: boolean } = {}): ModelCaller & { calls: ModelRequest[] } {
  const queue = [...responses];
  const calls: ModelRequest[] = [];
  return {
    enabled: opts.enabled ?? true,
    calls,
    modelId: (k) => (k === "light" ? "fake-light" : "fake-main"),
    async call(req) {
      calls.push(req);
      const next = queue.shift();
      if (next === undefined) throw new Error("fake: no more responses");
      const text = typeof next === "function" ? next() : next;
      return { text, stopReason: "end_turn", modelId: req.model === "light" ? "fake-light" : "fake-main", usage: { input: 10, output: 5, cacheRead: 0 } };
    },
    async stream(req, onText) {
      const r = await this.call(req);
      onText(r.text);
      return r;
    },
  };
}
