/**
 * بناء الخيارات والتحقق منها (0.4 أ.5): النموذج يصوغ والخادم يتحقق. ترتيب المصادر: كلمات المستخدم ← القالب ← النموذج.
 */
import { ai, OPTION_SOURCES, type Moment, type OptionSource } from "@/shared/config";
import fixedOptionsContent from "@content/fixed_options.ar.json";

const o = ai.response_modes.options;

export type ChoiceOption = { id: string; label: string; source: OptionSource };
export type RawOption = { id?: string; label: string; source?: OptionSource };

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** خيار «خطة كاملة»: سطور متعددة أو أكثر من جملة أو خطوات مرقّمة. */
export function looksLikeFullPlan(label: string): boolean {
  if (/[\n\r]/.test(label)) return true;
  if ((label.match(/[.!؟?؛;]/g) ?? []).length >= 2) return true;
  return /(^|\s)(\d+[.)]|الخطوة\s*\d)/.test(label);
}

export function validateOptions(options: RawOption[], max: number, userWords: string[] = []): string | null {
  if (options.length < o.min) return "too_few_options";
  if (options.length > max) return "too_many_options";
  const seen = new Set<string>();
  for (const x of options) {
    const label = x.label.trim();
    if (!label) return "empty_option";
    if ([...label].length > o.max_chars) return "option_too_long";
    if (looksLikeFullPlan(label)) return "option_is_full_plan";
    if (seen.has(norm(label))) return "duplicate_option";
    seen.add(norm(label));
  }
  if (o.require_user_words_when_available && userWords.length > 0 && !options.some((x) => x.source === "user_words")) return "missing_user_words_option";
  return null;
}

const rank = (s: OptionSource) => o.source_priority.indexOf(s);

export type BuildArgs = {
  moment: Moment; max: number;
  model: RawOption[];
  userWords: string[];
  template: string[];
};
export type BuildResult = { options: ChoiceOption[]; usedFixed: boolean; reason: string | null };

/** ثابت (مؤقت) من ملف المحتوى لكل لحظة. */
export function fixedOptionsFor(moment: Moment, max: number): ChoiceOption[] {
  const list = ((fixedOptionsContent as unknown as Record<string, string[]>)[moment] ?? (fixedOptionsContent as unknown as Record<string, string[]>).confirm ?? []).slice(0, max);
  return list.map((label, i) => ({ id: `f${i + 1}`, label, source: "template" as const }));
}

/**
 * يعيد خيارات صالحة دائمًا: خيارات النموذج بعد التحقق (مع إدراج خيار من كلمات المستخدم إن وُجدت ولم يأتِ منها شيء)،
 * وإلا خيارات ثابتة. المعرّفات تُعيَّن في الخادم.
 */
export function buildOptions(a: BuildArgs): BuildResult {
  const labelled: RawOption[] = a.model.map((x) => ({ ...x, source: x.source && OPTION_SOURCES.includes(x.source) ? x.source : "ai" }));
  // كلمات المستخدم أصل الخيار: إن طابق نصّه كلمات المستخدم يُرقَّى مصدره
  const userSet = new Set(a.userWords.map(norm));
  const templateSet = new Set(a.template.map(norm));
  for (const x of labelled) {
    if (userSet.has(norm(x.label))) x.source = "user_words";
    else if (templateSet.has(norm(x.label)) && x.source === "ai") x.source = "template";
  }
  let candidate = labelled;
  // إن توفرت كلمات للمستخدم ولم تأتِ في خيارات النموذج، نبدّل آخر خيار من النموذج بأول كلمات صالحة
  if (o.require_user_words_when_available && a.userWords.length > 0 && !candidate.some((x) => x.source === "user_words")) {
    const injected = a.userWords.map((w) => ({ label: w, source: "user_words" as const })).find((x) => !looksLikeFullPlan(x.label) && [...x.label].length <= o.max_chars);
    if (injected && !candidate.some((x) => norm(x.label) === norm(injected.label))) {
      candidate = candidate.length >= a.max ? [...candidate.slice(0, a.max - 1), injected] : [...candidate, injected];
    }
  }
  const err = validateOptions(candidate, a.max, a.userWords.filter((w) => !looksLikeFullPlan(w) && [...w].length <= o.max_chars));
  if (err) return { options: fixedOptionsFor(a.moment, a.max), usedFixed: true, reason: err };
  const ordered = [...candidate].sort((x, y) => rank(x.source!) - rank(y.source!));
  return { options: ordered.map((x, i) => ({ id: `o${i + 1}`, label: x.label.trim(), source: x.source! })), usedFixed: false, reason: null };
}
