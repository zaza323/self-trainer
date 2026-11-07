/**
 * تحويل الكتابة الحرة عن اليوم إلى مقاطع (0.4 ط.3 / ط.7) — المحلّل الحتمي (احتياطي day_reconstructor) والتحقق من أن أي
 * مقطع (من النموذج أو من هنا) لا يحمل وقتًا لم يُذكر. الفجوات تبقى فجوات. دالة نقية بأوقات محلية HH:MM.
 */
import categoriesContent from "@content/reconstruction_categories.ar.json";
import { normalizeAr } from "@/modules/planner/nlp";

type ParserContent = { wake_words: string[]; sleep_words: string[]; until_words: string[]; from_words: string[]; pm_words: string[]; am_words: string[]; clause_separators: string[]; keywords: Record<string, string[]> };
const P = (categoriesContent as unknown as { parser: ParserContent }).parser;
const DAY_START = "00:00";

export type TextBlock = { start: string; end: string; category: string; label: string | null; confidence: number };
export type TextParse = { blocks: TextBlock[]; gaps: Array<{ start: string; end: string }>; unplaced: Array<{ category: string; label: string }> };

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => normalizeAr(s.toLowerCase());
const hasWord = (text: string, words: string[]) => words.some((w) => new RegExp(`(^|\\s|[وفبل])${esc(norm(w))}(?=$|\\s|[،,.])`).test(text) || text.includes(` ${norm(w)} `));

function categoryOf(clause: string, allowed: Set<string>): string | null {
  for (const [cat, words] of Object.entries(P.keywords)) if (allowed.has(cat) && words.some((w) => clause.includes(norm(w)))) return cat;
  return null;
}

/** كل الأوقات المذكورة في النص بصيغتيها الممكنتين (ص/م) — أساس قاعدة «لا اختراع». */
export function mentionedTimes(text: string): Set<string> {
  const out = new Set<string>([DAY_START]);
  for (const m of norm(text).matchAll(/(\d{1,2})(?::(\d{2}))?/g)) {
    const h = Number(m[1]), mm = Number(m[2] ?? 0);
    if (h > 24 || mm > 59) continue;
    out.add(hhmm((h % 24) * 60 + mm));
    if (h < 12) out.add(hhmm((h + 12) * 60 + mm));
  }
  return out;
}

/** ط.12-4: مقطع يبدأ أو ينتهي بوقت لم يُذكر (ولا هو حد مقطع معروف) مرفوض. */
export function inventedTimes(blocks: Array<{ start: string; end: string }>, text: string, knownBoundaries: string[] = []): string[] {
  const allowed = mentionedTimes(text);
  for (const k of knownBoundaries) allowed.add(k);
  const bad: string[] = [];
  for (const b of blocks) for (const t of [b.start, b.end]) if (!allowed.has(t)) bad.push(t);
  return bad;
}

function splitClauses(text: string): string[] {
  let t = ` ${norm(text)} `;
  for (const sep of P.clause_separators) t = t.replace(new RegExp(`\\s${esc(norm(sep))}\\s`, "g"), " | ");
  return t.split(/[|،,.؛\n]|\sو(?=[^\s\d])/).map((c) => c.trim()).filter(Boolean);
}

function resolve(h: number, mm: number, cursor: number | null, clause: string): number {
  if (h >= 12) return (h % 24) * 60 + mm;
  if (hasWord(clause, P.pm_words)) return (h + 12) * 60 + mm;
  if (hasWord(clause, P.am_words)) return h * 60 + mm;
  const a = h * 60 + mm, b = (h + 12) * 60 + mm;
  if (cursor === null) return a;
  return a >= cursor ? a : b >= cursor ? b : a;
}

/**
 * «صحيت 9 وقعدت عالجوال لـ 11» ⇒ نوم 00:00–09:00، جوال 09:00–11:00. بدون وقت لا مقطع (يبقى في unplaced).
 * allowed = فئات الوضع العمري المتاحة.
 */
export function parseDayText(text: string, allowedCategories: string[], nowHHMM: string | null = null): TextParse {
  const allowed = new Set(allowedCategories);
  const blocks: TextBlock[] = [], unplaced: TextParse["unplaced"] = [];
  let cursor: number | null = null;
  let pending: { start: number; category: string; label: string } | null = null;
  const close = (end: number) => { if (pending && end > pending.start) blocks.push({ start: hhmm(pending.start), end: hhmm(end), category: pending.category, label: pending.label, confidence: 0.6 }); pending = null; };
  for (const clause of splitClauses(text)) {
    const nums = [...clause.matchAll(/(\d{1,2})(?::(\d{2}))?/g)].map((m) => ({ h: Number(m[1]), mm: Number(m[2] ?? 0), idx: m.index ?? 0 })).filter((n) => n.h <= 24 && n.mm <= 59);
    const isWake = hasWord(` ${clause} `, P.wake_words);
    const cat = isWake ? "sleep" : categoryOf(clause, allowed);
    const label = clause.replace(/\d{1,2}(:\d{2})?/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!nums.length) { if (cat && !isWake) unplaced.push({ category: cat, label }); continue; }
    const before = (i: number) => clause.slice(0, nums[i]!.idx).trim();
    const untilAt = nums.findIndex((_, i) => P.until_words.some((w) => before(i).endsWith(` ${norm(w)}`) || before(i) === norm(w) || before(i).endsWith(norm(w))));
    if (isWake && allowed.has("sleep")) {
      const t = resolve(nums[0]!.h, nums[0]!.mm, null, clause);
      close(t);
      blocks.push({ start: DAY_START, end: hhmm(t), category: "sleep", label: null, confidence: 0.8 });
      cursor = t;
      continue;
    }
    if (!cat) { const t = resolve(nums[0]!.h, nums[0]!.mm, cursor, clause); close(t); cursor = t; continue; }
    if (nums.length >= 2) {
      const a = resolve(nums[0]!.h, nums[0]!.mm, cursor, clause), b = resolve(nums[1]!.h, nums[1]!.mm, a, clause);
      close(a);
      if (b > a) blocks.push({ start: hhmm(a), end: hhmm(b), category: cat, label, confidence: 0.7 });
      cursor = b; continue;
    }
    const t = resolve(nums[0]!.h, nums[0]!.mm, cursor, clause);
    if (untilAt === 0) {
      const start = pending?.start ?? cursor;
      pending = null;
      if (start !== null && t > start) blocks.push({ start: hhmm(start), end: hhmm(t), category: cat, label, confidence: 0.7 });
      else unplaced.push({ category: cat, label });
      cursor = t;
    } else { close(t); pending = { start: t, category: cat, label }; cursor = t; }
  }
  if (pending) { const pd = pending as { start: number; category: string; label: string }; unplaced.push({ category: pd.category, label: pd.label }); }
  blocks.sort((x, y) => toMin(x.start) - toMin(y.start));
  const gaps: TextParse["gaps"] = [];
  const endOfKnown = nowHHMM ?? (blocks.length ? blocks[blocks.length - 1]!.end : DAY_START);
  let c = toMin(DAY_START);
  for (const b of blocks) { if (toMin(b.start) > c) gaps.push({ start: hhmm(c), end: b.start }); c = Math.max(c, toMin(b.end)); }
  if (toMin(endOfKnown) > c) gaps.push({ start: hhmm(c), end: endOfKnown });
  return { blocks, gaps, unplaced };
}
