/**
 * مستدعي النموذج (7.5): Claude API عبر SDK الرسمي، المفاتيح في الخادم فقط، المعرّف من متغير بيئة ليُبدَّل دون نشر.
 * الواجهة قابلة للحقن حتى تُختبر كل الوظائف باختبارات ثابتة بلا شبكة (ModelCaller).
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ai } from "@/shared/config";

export type ModelRequest = {
  model: "main" | "light";
  system: string;              // ثابت: يُخزَّن مؤقتًا
  dynamicSystem?: string;      // متغيّر: بعد نقطة التخزين
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
  jsonSchema?: Record<string, unknown>;  // مخطط JSON لمخرج مهيكل (اختياري)
};

export type ModelResponse = {
  text: string;
  stopReason: string | null;
  modelId: string;
  usage: { input: number; output: number; cacheRead: number };
};

export type ModelCaller = {
  enabled: boolean;
  modelId(kind: "main" | "light"): string;
  call(req: ModelRequest): Promise<ModelResponse>;
  /** بث نص فقط (companion_chat). */
  stream?(req: ModelRequest, onText: (t: string) => void): Promise<ModelResponse>;
};

export function resolveModelId(kind: "main" | "light"): string {
  const main = process.env[ai.models.main_env] || "claude-opus-5-5";
  const light = process.env[ai.models.light_env] || main;
  return kind === "light" ? light : main;
}

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AI_DISABLED !== "1";
}

export function anthropicCaller(): ModelCaller {
  const enabled = aiEnabled();
  const client = enabled ? new Anthropic() : null;
  const build = (req: ModelRequest): Anthropic.MessageCreateParamsNonStreaming => ({
    model: resolveModelId(req.model),
    max_tokens: req.maxOutputTokens,
    system: [
      { type: "text", text: req.system, ...(ai.prompt_caching ? { cache_control: { type: "ephemeral" as const } } : {}) },
      ...(req.dynamicSystem ? [{ type: "text" as const, text: req.dynamicSystem }] : []),
    ],
    messages: req.messages,
    ...(req.jsonSchema ? { output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema } } } : {}),
  });
  const usageOf = (m: Anthropic.Message) => ({ input: m.usage.input_tokens, output: m.usage.output_tokens, cacheRead: m.usage.cache_read_input_tokens ?? 0 });
  return {
    enabled,
    modelId: resolveModelId,
    async call(req) {
      if (!client) throw new Error("ai_disabled");
      const m = await client.messages.create(build(req));
      const text = m.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      return { text, stopReason: m.stop_reason, modelId: m.model, usage: usageOf(m) };
    },
    async stream(req, onText) {
      if (!client) throw new Error("ai_disabled");
      const { output_config: _omit, ...params } = build(req);
      void _omit;
      const s = client.messages.stream({ ...params, max_tokens: req.maxOutputTokens });
      s.on("text", (t) => onText(t));
      const m = await s.finalMessage();
      const text = m.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      return { text, stopReason: m.stop_reason, modelId: m.model, usage: usageOf(m) };
    },
  };
}
