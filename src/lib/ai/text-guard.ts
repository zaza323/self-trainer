/**
 * حارس الأرقام والتواريخ (0.5 ج.3 RULES-4، ai.json › text_guard): كل رقم أو تاريخ في نص مولَّد يجب أن يكون ضمن المدخلات
 * التي أعطاها الخادم، وإلا يُهمل النص ويُستخدم القالب الثابت (companion_chat: تسجيل فقط). دالة نقية حتمية.
 */
import words from "@content/number_words.ar.json";

const norm = (s: string) => s
  .replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/٫/g, ".").toLowerCase();
const W = words as unknown as { numbers: Record<string, string[]>; months: Record<string, string[]> };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUM_WORDS = Object.entries(W.numbers).flatMap(([n, ws]) => ws.map((w) => ({ n: Number(n), re: new RegExp(`(^|[^\\p{L}])[وبلف]?${esc(w)}(?=$|[^\\p{L}])`, "u") })));
const MONTHS = Object.entries(W.months).flatMap(([m, ws]) => ws.map((w) => ({ m: Number(m), w })));

export type Extracted = { numbers: number[]; dates: string[] };

/** يستخرج التواريخ أولًا (ثم يحذفها من النص) ثم الأرقام بالأرقام وبالكلمات. */
export function extract(text: string): Extracted {
  let t = ` ${norm(text)} `;
  const dates: string[] = [];
  const take = (re: RegExp, f: (m: RegExpMatchArray) => string[]) => { t = t.replace(re, (...args) => { dates.push(...f(args as unknown as RegExpMatchArray)); return " "; }); };
  take(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (m) => [`${+m[3]!}/${+m[2]!}/${m[1]}`, `${+m[3]!}/${+m[2]!}`]);
  take(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g, (m) => (m[3] ? [`${+m[1]!}/${+m[2]!}/${m[3]}`, `${+m[1]!}/${+m[2]!}`] : [`${+m[1]!}/${+m[2]!}`]));
  for (const { m, w } of MONTHS) take(new RegExp(`(\\d{1,2})\\s*${esc(w)}`, "g"), (x) => [`${+x[1]!}/${m}`]);
  const numbers = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
  for (const { n, re } of NUM_WORDS) if (re.test(t)) numbers.push(n);
  return { numbers, dates };
}

export type GuardResult = { ok: true } | { ok: false; violations: string[] };

/** النص المولَّد (أي عدد من الحقول) مقابل نص المدخلات. */
export function guardText(generated: string[], input: string): GuardResult {
  const inp = extract(input);
  const nums = new Set(inp.numbers.map(String)), dates = new Set(inp.dates);
  const violations: string[] = [];
  for (const g of generated) {
    const e = extract(g);
    for (const d of e.dates) if (!dates.has(d)) violations.push(`date:${d}`);
    for (const n of e.numbers) if (!nums.has(String(n))) violations.push(`number:${n}`);
  }
  return violations.length ? { ok: false, violations } : { ok: true };
}

/** كل النصوص في مخرج مهيكل (تكراريًا). */
export function stringsOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(stringsOf);
  if (v && typeof v === "object") return Object.values(v).flatMap(stringsOf);
  return [];
}
