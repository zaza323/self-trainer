/**
 * التدهور التلقائي إلى AI-OFF (0.5 ج.4، ai.json › ai_off): يُقرأ من ai_calls فقط (لا حالة أخرى).
 * - أخطاء المزوّد/المهلة: ≥ provider_errors_threshold خلال window_minutes ⇒ متوقف حتى يمر recover_after_minutes بلا خطأ جديد.
 * - الميزانية: ≥ daily_global_calls_budget استدعاء اليوم (UTC) ⇒ متوقف حتى الغد.
 * يأخذ الوقت محقونًا (now) ليبقى قابلًا للاختبار.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ai } from "@/shared/config";

export type Health = { degraded: false } | { degraded: true; reason: "provider_error_rate" | "timeout" | "budget_exhausted"; until: string | null };
const cfg = () => ai.ai_off.auto_degrade;

export async function aiHealth(db: SupabaseClient, now: Date): Promise<Health> {
  const c = cfg();
  const on = new Set(ai.ai_off.auto_degrade_on);
  if (on.has("provider_error_rate") || on.has("timeout")) {
    const since = new Date(now.getTime() - (c.window_minutes + c.recover_after_minutes) * 60000).toISOString();
    const { data } = await db.from("ai_calls").select("created_at, meta").eq("valid", false).gte("created_at", since);
    const errs = ((data ?? []) as Array<{ created_at: string; meta: { provider_error?: boolean; timeout?: boolean } | null }>)
      .filter((r) => r.meta?.provider_error && (on.has("provider_error_rate") || r.meta.timeout))
      .map((r) => ({ t: new Date(r.created_at).getTime(), timeout: Boolean(r.meta?.timeout) })).sort((a, b) => b.t - a.t);
    const latest = errs[0];
    if (latest && now.getTime() - latest.t < c.recover_after_minutes * 60000) {
      const burst = errs.filter((e) => latest.t - e.t <= c.window_minutes * 60000);
      if (burst.length >= c.provider_errors_threshold) {
        return { degraded: true, reason: burst.every((e) => e.timeout) ? "timeout" : "provider_error_rate", until: new Date(latest.t + c.recover_after_minutes * 60000).toISOString() };
      }
    }
  }
  if (on.has("budget_exhausted")) {
    const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
    const { data: today } = await db.from("ai_calls").select("id").gte("created_at", day.toISOString()).limit(c.daily_global_calls_budget);
    if ((today ?? []).length >= c.daily_global_calls_budget) { const next = new Date(day.getTime() + 86400000); return { degraded: true, reason: "budget_exhausted", until: next.toISOString() }; }
  }
  return { degraded: false };
}

/** هل الخطأ من المزوّد (شبكة/مهلة/خدمة) لا من التحقق؟ */
export function providerErrorMeta(e: unknown): { provider_error: true; timeout: boolean } {
  const m = String((e as Error)?.message ?? e);
  return { provider_error: true, timeout: /timeout|timed out|ETIMEDOUT|aborted/i.test(m) };
}
