/**
 * مصنّف الأمان (7.4): قوائم كلمات (خط أول، بلا شبكة) + تصنيف النموذج (إن كان مفعّلًا). دالة نقية للكلمات.
 */
import keywords from "@content/safety_keywords.ar.json";
import type { Safety } from "@/modules/companion/schemas";

const CATEGORIES = ["self_harm", "abuse", "immediate_danger", "age_inappropriate"] as const;

/** تطبيع عربي بسيط: إزالة التشكيل والتطويل، توحيد الألف والتاء المربوطة. */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function keywordSafety(text: string): Safety {
  const n = normalizeArabic(text);
  for (const cat of CATEGORIES) {
    const list = (keywords as unknown as Record<string, string[]>)[cat] ?? [];
    if (list.some((k) => n.includes(normalizeArabic(k)))) {
      const severity: Safety["severity"] = cat === "age_inappropriate" ? "low" : cat === "immediate_danger" || cat === "self_harm" ? "high" : "medium";
      return { flag: true, category: cat, severity };
    }
  }
  return { flag: false, category: null, severity: null };
}

const ORDER: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** دمج نتيجتين: الأعلى شدة يغلب. */
export function mergeSafety(a: Safety, b: Safety): { safety: Safety; detector: "keywords" | "model" | "both" | "none" } {
  if (a.flag && b.flag) return { safety: (ORDER[a.severity ?? "low"] ?? 0) >= (ORDER[b.severity ?? "low"] ?? 0) ? a : b, detector: "both" };
  if (a.flag) return { safety: a, detector: "keywords" };
  if (b.flag) return { safety: b, detector: "model" };
  return { safety: a, detector: "none" };
}
