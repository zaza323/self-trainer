/**
 * i18n خفيفة: العربية أولًا مع RTL كامل، وبنية جاهزة للإنجليزية.
 * المفاتيح منقّطة ("settings.title") ومعاملات {name}. المفقود في لغة يسقط إلى العربية.
 */
import ar from "./messages/ar.json";
import en from "./messages/en.json";

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";

const dictionaries: Record<Locale, Record<string, unknown>> = { ar, en };

export function dir(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

function lookup(dict: Record<string, unknown>, path: string): string | undefined {
  let cur: unknown = dict;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function translator(locale: Locale = DEFAULT_LOCALE) {
  return function t(key: string, params?: Record<string, string | number>): string {
    const raw = lookup(dictionaries[locale], key) ?? lookup(dictionaries[DEFAULT_LOCALE], key) ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
  };
}

export const t = translator("ar");
