/**
 * سياسة شكل الرد (0.4 أ.3–أ.4): دوال نقية يفرضها الخادم، لا النموذج. كل القيم من config/ai.json.response_modes.
 */
import { ai, SUPPORT_LEVELS, type AgeMode, type Moment, type ResponseMode, type SupportLevel } from "@/shared/config";

const rm = ai.response_modes;
export type SupportBand = "L0_L1" | "L2_L3";

/** L0–L1 أو L2–L3 (الحد الفاصل هو أول مستوى في الفئة الثانية). */
export function supportBand(level: SupportLevel): SupportBand {
  return SUPPORT_LEVELS.indexOf(level) < SUPPORT_LEVELS.indexOf("L2_ask") ? "L0_L1" : "L2_L3";
}

/**
 * مستوى الدعم المستخدم للحظة: مستوى القدرة الأقرب إليها (moment_capability)، وإن لم توجد فمتوسط مستويات الدعم
 * (يُقرَّب للأسفل: عند التعادل يُفضَّل الدعم الأكثر).
 */
export function momentSupport(moment: Moment, byCapability: Partial<Record<string, SupportLevel>>, fallbackAll: SupportLevel[]): SupportLevel {
  const cap = rm.moment_capability[moment];
  const direct = cap ? byCapability[cap] : undefined;
  if (direct) return direct;
  const all = fallbackAll.length ? fallbackAll : Object.values(byCapability).filter((x): x is SupportLevel => Boolean(x));
  if (all.length === 0) return SUPPORT_LEVELS[0]!;
  const avg = all.reduce((s, l) => s + SUPPORT_LEVELS.indexOf(l), 0) / all.length;
  return SUPPORT_LEVELS[Math.floor(avg)]!;
}

export type PolicyInput = { moment: Moment; support: SupportLevel; ageMode: AgeMode; afterStuck: boolean };

/** الشكل الأساسي قبل ميزانية الكتابة. */
export function policyMode({ moment, support, ageMode, afterStuck }: PolicyInput): ResponseMode {
  const p = rm.policy[moment];
  if (p.never_choices) return "free_text";
  if (afterStuck) {
    if (p.after_stuck) return p.after_stuck;
    if (moment !== "stuck") return rm.policy.stuck[supportBand(support)];
  }
  if (p.child_override && ageMode === "child") return p.child_override;
  return p[supportBand(support)];
}

/** أقصى عدد خيارات: stuck (أو بعد stuck) له حد خاص، وإلا حد الخيارات العام. */
export function maxOptionsFor(moment: Moment, afterStuck: boolean): number {
  const stuckMax = rm.policy.stuck.max_options ?? rm.options.max;
  if (afterStuck && !rm.policy[moment].never_choices) return Math.min(stuckMax, rm.options.max);
  return Math.min(rm.policy[moment].max_options ?? rm.options.max, rm.options.max);
}

const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };

/** هل الوقت المحلي ضمن نطاق (يدعم العبور فوق منتصف الليل)؟ */
export function inRange(localHHMM: string, range: readonly [string, string]): boolean {
  const t = toMinutes(localHHMM), a = toMinutes(range[0]), b = toMinutes(range[1]);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

export type BudgetInput = { localTime: string; comebackSession: boolean; preferChoices: boolean };

/** ميزانية لحظات free_text الإلزامية في الجلسة (أ.4). */
export function freeTextBudget({ localTime, comebackSession, preferChoices }: BudgetInput): number {
  const b = rm.free_text_budget;
  const reduced = inRange(localTime, b.reduced_when.local_time_between) || (b.reduced_when.comeback_session && comebackSession) || preferChoices;
  return reduced ? b.reduced : b.per_session;
}

/** هل تُحتسب هذه اللحظة من ميزانية الكتابة؟ goal_why معفاة؛ free_chat محادثة حرة بطبيعتها فلا تُحتسب (قرار موثّق). */
export function consumesBudget(moment: Moment): boolean {
  return moment !== "free_chat" && !rm.policy[moment].exempt_from_budget;
}

export function applyBudget(mode: ResponseMode, moment: Moment, used: number, budget: number): ResponseMode {
  if (mode !== "free_text" || !consumesBudget(moment)) return mode;
  return used >= budget ? rm.free_text_budget.degrade_to : mode;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[ً-ٰٟ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** "لا أعرف" وما يشبهها (أ.3 stuck). */
export function isStuckText(text: string): boolean {
  const n = norm(text);
  return rm.stuck_triggers.phrases.some((p) => n.includes(norm(p)));
}
export function isStuckHesitation(seconds: number): boolean {
  return seconds > rm.stuck_triggers.hesitation_seconds;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** الحد الأدنى اللطيف (أ.4): سؤال متابعة مرة واحدة فقط ثم القبول. */
export function needsSoftFollowUp(a: { moment: Moment; ageMode: AgeMode; text: string; alreadyAsked: boolean; inputMethod?: "typed" | "voice" | "option" }): boolean {
  const s = rm.soft_min_words;
  if (!s.moments.includes(a.moment) || a.inputMethod === "option") return false;
  if (s.follow_up_once && a.alreadyAsked) return false;
  const min = s[a.ageMode];
  return min > 0 && wordCount(a.text) < min;
}
