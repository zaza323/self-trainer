/**
 * سياق الحياة (4.13.1، ADAPT-1/2) — تحقق نقي: الحقول الأربعة، حد العناصر، ومنع المحتوى الممنوع
 * (معلومات صحية، أسماء غرباء غير قابلة للكشف آليًا فتُترك للإرشاد، مواقع دقيقة وأرقام هواتف).
 */
import { customization } from "@/shared/config";
import content from "@content/personal_context.ar.json";

export type ContextField = "interests" | "routine" | "free_windows" | "contexts";
export type PersonalContext = Record<ContextField, string[]>;

export const CONTEXT_FIELDS = customization.personal_context.fields as ContextField[];

export function validateContextItem(field: ContextField, value: string): { ok: true; value: string } | { ok: false; reason: "empty" | "too_long" | "health" | "precise_location" | "phone" } {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v) return { ok: false, reason: "empty" };
  if (v.length > 80) return { ok: false, reason: "too_long" };
  const fp = content.forbidden_patterns;
  if (customization.personal_context.forbidden_content.includes("health") && fp.health.some((k) => v.includes(k))) return { ok: false, reason: "health" };
  if (customization.personal_context.forbidden_content.includes("precise_locations")) {
    if (fp.precise_location.some((k) => v.includes(k))) return { ok: false, reason: "precise_location" };
    if (/\d{7,}/.test(v.replace(/[\s-]/g, ""))) return { ok: false, reason: "phone" };
  }
  return { ok: true, value: v };
}

export function addContextItem(pc: PersonalContext, field: ContextField, value: string): { ok: true; pc: PersonalContext } | { ok: false; reason: string } {
  const r = validateContextItem(field, value);
  if (!r.ok) return r;
  const list = pc[field] ?? [];
  if (list.includes(r.value)) return { ok: true, pc };
  if (list.length >= customization.personal_context.max_items_per_field) return { ok: false, reason: "max_items" };
  return { ok: true, pc: { ...pc, [field]: [...list, r.value] } };
}

export const emptyContext = (): PersonalContext => ({ interests: [], routine: [], free_windows: [], contexts: [] });
