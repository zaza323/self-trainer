/**
 * هامش الوقت (0.5 الجزء ب) — قواعد نقية، بلا ذكاء اصطناعي وبلا قاعدة بيانات. كل القيم من config/margins.json.
 * الهامش لا يدخل XP ولا البوابات ولا الأدلة ولا درجة القدرة (ب.6): لا شيء هنا يُستورد من وحدات الأدلة أو النقاط.
 */
import { margins, SUPPORT_LEVELS, type AgeMode, type SupportLevel } from "@/shared/config";
import content from "@content/margins.ar.json";

export type SubjectType = "mission" | "planner_task";
export type Similarity = { l1: string | null; l2: string | null };
export type MarginSource = "user" | "guardian" | "guardian_rule" | "history" | "system";
export type DefaultBasis = "history_actuals" | "user_estimate" | "template_range" | "age_default";
const DAY_MS = 86400000;

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** تقريب لأعلى لأقرب خطوة (بعد تنظيف كسور الفاصلة العائمة). */
export const ceilToStep = (x: number): number => Math.ceil(Math.round(x * 1000) / 1000 / margins.step_min) * margins.step_min;
export const clampToMode = (x: number, mode: AgeMode): number => Math.min(margins.bounds_min[mode].max, Math.max(margins.bounds_min[mode].min, x));
/** ب.11-4: قيمة يضبطها إنسان: تُقرَّب لمضاعف الخطوة ثم تُقص إلى حدود الوضع. */
export const normalizeSetValue = (x: number, mode: AgeMode): number => clampToMode(ceilToStep(x), mode);

export const bufferFor = (mode: AgeMode, supportLevel: SupportLevel): number =>
  margins.default_rule.buffer_pct_by_age[mode] + margins.default_rule.buffer_add_by_support_level[supportLevel];

export type DefaultInput = {
  mode: AgeMode; supportLevel: SupportLevel;
  actuals: number[];                 // أزمنة فعلية لمهام مشابهة مكتملة ضمن نافذة النظر للخلف (L1 ثم L2 يختارها المستدعي)
  userEstimate: number | null;
  templateRange: { min: number; max: number } | null;
  freeGapMin: number | null;
};
export type DefaultResult = { value: number; basis: DefaultBasis; detail: Record<string, number> };

/** ب.4: أول شرط يتحقق يُستخدم، ثم التقريب، ثم القص، ثم عدم تجاوز الفجوة. */
export function systemDefault(i: DefaultInput): DefaultResult {
  const d = margins.default_rule, buf = bufferFor(i.mode, i.supportLevel);
  let raw: number, basis: DefaultBasis, detail: Record<string, number>;
  if (i.actuals.length >= d.history_actuals.min_samples) {
    const med = median(i.actuals);
    raw = med * (1 + buf); basis = "history_actuals"; detail = { n: i.actuals.length, median: med };
  } else if (i.userEstimate && i.userEstimate > 0) {
    raw = i.userEstimate * (1 + buf); basis = "user_estimate"; detail = { estimate: i.userEstimate };
  } else if (i.templateRange) {
    const mid = (i.templateRange.min + i.templateRange.max) / 2;
    raw = Math.min(mid * d.template_range.age_factor[i.mode], d.template_range.clamp_to_template_max_factor * i.templateRange.max);
    basis = "template_range"; detail = { min: i.templateRange.min, max: i.templateRange.max };
  } else { raw = d.age_default_min[i.mode]; basis = "age_default"; detail = {}; }
  let value = clampToMode(ceilToStep(raw), i.mode);
  if (d.never_exceed_free_gap && i.freeGapMin !== null && i.freeGapMin > 0 && value > i.freeGapMin) value = i.freeGapMin;
  return { value, basis, detail };
}

/** ب.5: تطبيع حتمي لعنوان مهمة المخطط (أحرف صغيرة، بلا أرقام ولا كلمات وقت ولا تشكيل، وتوحيد الألف والياء والتاء المربوطة). */
const norm = (s: string) => s.toLowerCase()
  .replace(/[ً-ٰٟـ]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
const TIME_WORDS = new Set(content.time_words.map(norm));
export function normalizeTitle(title: string): string {
  return norm(title).replace(/[0-9٠-٩۰-۹]/g, " ").replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/).filter((w) => w && !TIME_WORDS.has(w)).join(" ");
}

export const missionSimilarity = (t: { template_id: string; capability_id: string; mechanic: string }): Similarity =>
  ({ l1: `tpl:${t.template_id}`, l2: `cap:${t.capability_id}|mech:${t.mechanic}` });
export function plannerSimilarity(t: { title: string; project_id: string | null; tag_ids: string[] }): Similarity {
  const n = normalizeTitle(t.title);
  const l2 = t.project_id || t.tag_ids.length ? `proj:${t.project_id ?? "-"}|tags:${[...t.tag_ids].sort().join(",")}` : null;
  return { l1: n ? `title:${n}` : null, l2 };
}

export type MarginEventLite = { similarity: Similarity; set_min: number; created_at: string; guardian_link_id: string | null; profile_id: string };
export type Recommendation = { value: number; level: "L1" | "L2"; n: number };

/**
 * ب.5: التوصية من تعديلات هذا المتدرب فقط: أحدث window_events خلال lookback_days على L1، فإن لم توجد فعلى L2؛ القيمة = الوسيط.
 * إن اختلف المربون يؤخذ المنشئ أولًا ثم الأحدث. يرفض أي حدث لا يخص profileId (لا مقارنة بين مستخدمين أبدًا).
 */
export function recommend(events: MarginEventLite[], i: { profileId: string; sim: Similarity; now: Date; creatorLinkId: string | null; mode: AgeMode }): Recommendation | null {
  if (events.some((e) => e.profile_id !== i.profileId)) throw new Error("margin events of another profile");
  const h = margins.history, since = i.now.getTime() - h.lookback_days * DAY_MS;
  const recent = events.filter((e) => new Date(e.created_at).getTime() >= since && new Date(e.created_at).getTime() <= i.now.getTime());
  for (const level of ["L1", "L2"] as const) {
    const key = level === "L1" ? i.sim.l1 : i.sim.l2;
    if (!key) continue;
    let pool = recent.filter((e) => (level === "L1" ? e.similarity.l1 : e.similarity.l2) === key);
    if (i.creatorLinkId && pool.some((e) => e.guardian_link_id === i.creatorLinkId)) pool = pool.filter((e) => e.guardian_link_id === i.creatorLinkId);
    pool = pool.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, h.window_events);
    if (pool.length >= h.min_events) return { value: normalizeSetValue(median(pool.map((e) => e.set_min)), i.mode), level, n: pool.length };
  }
  return null;
}

export type HistoryMode = "prefill" | "suggest_only" | "off";
export type RuleLite = { id: string; similarity_key: string; level: "L1" | "L2"; margin_min: number; set_by: string | null; guardian_link_id: string | null; is_creator: boolean; updated_at: string };
export type ResolveInput = {
  mode: AgeMode; sim: Similarity;
  task: { margin_min: number | null; margin_source: MarginSource | null; margin_set_by: string | null };
  rules: RuleLite[]; recommendation: Recommendation | null; historyMode: HistoryMode; system: DefaultResult;
};
export type Resolved = {
  margin_min: number; source: MarginSource; set_by: string | null; rule: string;
  suggestion: Recommendation | null;            // suggest_only: تُعرض كاقتراح بلمسة ولا تُملأ
  system_default: number; basis: DefaultBasis; detail: Record<string, number>;
};

function pickRule(rules: RuleLite[], sim: Similarity, mode: AgeMode, own: boolean): RuleLite | null {
  for (const level of ["L1", "L2"] as const) {
    const key = level === "L1" ? sim.l1 : sim.l2;
    if (!key) continue;
    let pool = rules.filter((r) => r.level === level && r.similarity_key === key && (r.guardian_link_id === null) === own);
    if (!pool.length) continue;
    if (!own && margins.precedence.among_guardians[mode] === "creator_lock_then_latest" && pool.some((r) => r.is_creator)) pool = pool.filter((r) => r.is_creator);
    return pool.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]!;
  }
  return null;
}

/** ب.3: الأخصّ يغلب بحسب ترتيب الوضع العمري في الإعدادات، ثم القص إلى حدود الوضع. */
export function resolveMargin(i: ResolveInput): Resolved {
  const base = { suggestion: null as Recommendation | null, system_default: i.system.value, basis: i.system.basis, detail: i.system.detail };
  const out = (margin_min: number, source: MarginSource, set_by: string | null, rule: string): Resolved => ({ ...base, margin_min: clampToMode(margin_min, i.mode), source, set_by, rule });
  for (const step of margins.precedence[i.mode]) {
    if (step === "user_override") {
      if (i.task.margin_min && i.task.margin_source === "user") return out(i.task.margin_min, "user", i.task.margin_set_by, "margin_user_override");
      const own = pickRule(i.rules, i.sim, i.mode, true);
      if (own) return out(own.margin_min, "user", own.set_by, "margin_user_override");
    } else if (step === "guardian_this_task") {
      if (i.task.margin_min && i.task.margin_source === "guardian") return out(i.task.margin_min, "guardian", i.task.margin_set_by, "margin_guardian_this_task");
    } else if (step === "guardian_rule") {
      const r = pickRule(i.rules, i.sim, i.mode, false);
      if (r) return out(r.margin_min, "guardian_rule", r.set_by, "margin_guardian_rule");
    } else if (step === "history_prefill") {
      if (i.recommendation && i.historyMode === "prefill") return out(i.recommendation.value, "history", null, "margin_history");
    } else if (step === "system_default") {
      const r = out(i.system.value, "system", null, `margin_default_${i.system.basis}`);
      return { ...r, margin_min: i.system.value, suggestion: i.historyMode === "suggest_only" ? i.recommendation : null };
    }
  }
  return out(i.system.value, "system", null, `margin_default_${i.system.basis}`);
}

/** ب.6 منع التأثر: عند L2 فما فوق لقدرة التخطيط لا يظهر الهامش قبل أن يكتب المستخدم تقديره. */
export function hiddenUntilEstimate(planningSupport: SupportLevel, hasEstimate: boolean): boolean {
  const from = margins.display.hide_until_user_estimate.from_support_level as SupportLevel;
  return SUPPORT_LEVELS.indexOf(planningSupport) >= SUPPORT_LEVELS.indexOf(from) && !hasEstimate;
}

/** ب.6: بطاقة «تمّت؟» بعد نهاية الهامش (مع الزيادات) + مهلة المتابعة. */
export const followupAfterMin = (marginMin: number, extraMin: number, graceMin: number): number => marginMin + extraMin + graceMin;

export type ReviewFinding = { similarity_key: string; level: "L1" | "L2"; subject_type: SubjectType; kind: "tight" | "loose"; n: number; median_actual: number; margin_min: number; proposed_min: number };
/** ب.7: كشف بقواعد فقط. مفتاح فيه ≥ min_completions إنجازات ضمن النافذة: النسبة > الضيق أو < الواسع ⇒ اقتراح واحد. */
export function reviewKey(i: { similarity_key: string; level: "L1" | "L2"; subject_type: SubjectType; actuals: number[]; margin_min: number; mode: AgeMode }): ReviewFinding | null {
  const r = margins.review;
  if (i.actuals.length < r.min_completions || i.margin_min <= 0) return null;
  const med = median(i.actuals), ratio = med / i.margin_min;
  const kind = ratio > r.too_tight_if_median_actual_over_margin_ratio ? "tight" : ratio < r.too_loose_if_median_actual_under_margin_ratio ? "loose" : null;
  if (!kind) return null;
  const proposed = normalizeSetValue(med * (1 + margins.default_rule.buffer_pct_by_age[i.mode]), i.mode);
  if (proposed === i.margin_min) return null;
  return { similarity_key: i.similarity_key, level: i.level, subject_type: i.subject_type, kind, n: i.actuals.length, median_actual: med, margin_min: i.margin_min, proposed_min: proposed };
}

export const fill = (tpl: string, vars: Record<string, string | number>): string => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
export const reviewText = (f: ReviewFinding): string => fill(content.review.text, { n: f.n, median: Math.round(f.median_actual), margin: f.margin_min });
export const basisText = (r: { basis: DefaultBasis; detail: Record<string, number> }): string => fill(content.basis[r.basis], { ...r.detail, median: Math.round(r.detail.median ?? 0) });
