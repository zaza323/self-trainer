/**
 * مرآة الواقع (0.4 ط، الشق اليدوي) — قواعد نقية: الملء المسبق، الفجوات، التوزيع، المخطط له مقابل غير المخطط،
 * ساعات الطاقة، الأنماط الحتمية (بقواعد config)، التوقّع مقابل الواقع (دليل وعي R1). «مش حكم، صورة.»
 */
import { planner } from "@/shared/config";
import { predictionValue } from "@/modules/evidence/rules";
import { scoring } from "@/shared/config";

const cfg = planner.reality_mirror as unknown as {
  triggers: Record<string, unknown>; mirror_week: { replaces_muhasaba_step: string; no_plan_changes_during: boolean };
  reconstruction: { target_minutes_max: number; prefill_from: string[]; gap_fill_modes: string[]; unknown_is_valid: boolean; energy_question_min_block_minutes: number; screen_time: { auto_read: boolean; ask_estimate: boolean; suggest_os_screen_time: boolean }; data_minimization: { locations: boolean; person_names: boolean } };
  prediction: { categories: number; pick: string[]; input: string };
  mirror: { sections: string[]; title_fixed: string; forbid: string[]; user_notices_first: boolean; patterns_as_questions: boolean; rest_family_prayer_sleep_valued: boolean; patterns: { max: number; rules: string[] } };
  planning: Record<string, unknown>; evidence: { rule_weight: number; negative_from_behavior: boolean; R1: { value: { kind: string; tolerance: number } } }; privacy: Record<string, unknown>;
};
export const mirrorConfig = cfg;

export type Segment = { starts_at: string; ends_at: string; category: string; label?: string | null; energy?: "high" | "normal" | "low" | null; origin: "prefilled" | "chat" | "manual" | "ai_parsed"; was_planned: boolean };
export const UNKNOWN = "unknown";
const minutes = (s: Segment) => Math.max(0, (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);

export type PrefillInput = {
  followupsDone: Array<{ title: string; startsAt: string; endsAt: string; category: string }>;
  focusSessions: Array<{ started_at: string; ended_at: string | null; minutes: number; title: string | null }>;
  blocks: Array<{ starts_at: string; ends_at: string; title: string }>;
  restSessions: Array<{ started_at: string; ended_at: string | null; planned_min: number; activity_key: string }>;
  retro: Array<{ title: string; approx_at: string; minutes: number }>;
  sleep: { wake: string | null; dayStart: string };     // بداية اليوم المحلي ووقت الاستيقاظ (إن وُجد) ⇒ مقطع نوم
};

/** ط.3-1: مقاطع جاهزة مما يعرفه التطبيق. */
export function prefillSegments(i: PrefillInput): Segment[] {
  const out: Segment[] = [];
  if (i.sleep.wake && i.sleep.wake > i.sleep.dayStart) out.push({ starts_at: i.sleep.dayStart, ends_at: i.sleep.wake, category: "sleep", origin: "prefilled", was_planned: true });
  for (const f of i.followupsDone) out.push({ starts_at: f.startsAt, ends_at: f.endsAt, category: f.category, label: f.title, origin: "prefilled", was_planned: true });
  for (const s of i.focusSessions) out.push({ starts_at: s.started_at, ends_at: s.ended_at ?? new Date(new Date(s.started_at).getTime() + s.minutes * 60000).toISOString(), category: "study", label: s.title, origin: "prefilled", was_planned: true });
  for (const b of i.blocks) out.push({ starts_at: b.starts_at, ends_at: b.ends_at, category: "study", label: b.title, origin: "prefilled", was_planned: true });
  for (const r of i.restSessions) out.push({ starts_at: r.started_at, ends_at: r.ended_at ?? new Date(new Date(r.started_at).getTime() + r.planned_min * 60000).toISOString(), category: "restorative_rest", label: r.activity_key, origin: "prefilled", was_planned: true });
  for (const r of i.retro) out.push({ starts_at: r.approx_at, ends_at: new Date(new Date(r.approx_at).getTime() + r.minutes * 60000).toISOString(), category: UNKNOWN, label: r.title, origin: "prefilled", was_planned: false });
  return mergeOverlaps(out.sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
}

/** تداخل المقاطع يُقصّ (الأسبق يغلب) حتى لا يُحسب الوقت مرتين. */
export function mergeOverlaps(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  let cursor = "";
  for (const s of segs) {
    const start = s.starts_at > cursor ? s.starts_at : cursor;
    if (start >= s.ends_at) continue;
    out.push({ ...s, starts_at: start });
    cursor = s.ends_at;
  }
  return out;
}

/** ط.3-2: الفجوات بين المقاطع من بداية اليوم حتى الآن. */
export function gaps(segs: Segment[], dayStart: string, until: string, minGapMin = 15): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  let cursor = dayStart;
  for (const s of [...segs].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    if (s.starts_at > cursor && (new Date(s.starts_at).getTime() - new Date(cursor).getTime()) / 60000 >= minGapMin) out.push({ start: cursor, end: s.starts_at });
    if (s.ends_at > cursor) cursor = s.ends_at;
  }
  if (until > cursor && (new Date(until).getTime() - new Date(cursor).getTime()) / 60000 >= minGapMin) out.push({ start: cursor, end: until });
  return out;
}

/** توزيع الدقائق حسب الفئة. */
export function distribution(segs: Segment[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const s of segs) d[s.category] = (d[s.category] ?? 0) + minutes(s);
  return d;
}
export function unknownShare(segs: Segment[]): number { const d = distribution(segs); const total = Object.values(d).reduce((a, b) => a + b, 0); return total ? (d[UNKNOWN] ?? 0) / total : 0; }
export function plannedShare(segs: Segment[]): number { const total = segs.reduce((a, s) => a + minutes(s), 0); return total ? segs.filter((s) => s.was_planned).reduce((a, s) => a + minutes(s), 0) / total : 0; }
export function energyHours(segs: Segment[], tz: string): number[] {
  const hour = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  return [...new Set(segs.filter((s) => s.energy === "high").map((s) => hour(s.starts_at)))].sort((a, b) => a - b);
}

export type Pattern = { rule: string; category?: string; hour?: number; share?: number; hours?: number[]; minutes?: number };

/** ط.5-6: 1–3 أنماط مكتشفة حتميًا بقواعد config، تُصاغ لاحقًا كأسئلة لا كأحكام. */
export function detectPatterns(days: Segment[][], tz: string): Pattern[] {
  const out: Pattern[] = [];
  const all = days.flat();
  const hour = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  for (const rule of cfg.mirror.patterns.rules) {
    if (out.length >= cfg.mirror.patterns.max) break;
    if (rule === "top_categories") {
      const d = distribution(all); const top = Object.entries(d).filter(([k]) => k !== UNKNOWN).sort((a, b) => b[1] - a[1])[0];
      if (top) out.push({ rule, category: top[0], minutes: Math.round(top[1] / Math.max(1, days.length)) });
    } else if (rule === "same_window_3_days") {
      const seen = new Map<string, Set<number>>();
      days.forEach((segs, di) => { for (const s of segs) for (let h = hour(s.starts_at); h < hour(s.starts_at) + Math.ceil(minutes(s) / 60); h++) { const k = `${s.category}:${h}`; if (!seen.has(k)) seen.set(k, new Set()); seen.get(k)!.add(di); } });
      const hit = [...seen.entries()].filter(([k, ds]) => ds.size >= 3 && !k.startsWith(`${UNKNOWN}:`)).sort((a, b) => b[1].size - a[1].size)[0];
      if (hit) { const [cat, h] = hit[0].split(":"); out.push({ rule, category: cat, hour: Number(h) }); }
    } else if (rule === "unknown_share_above_0.25") {
      const sh = unknownShare(all); if (sh > 0.25) out.push({ rule, share: Number(sh.toFixed(2)) });
    } else if (rule === "unplanned_share") {
      const sh = 1 - plannedShare(all); if (sh >= 0.5) out.push({ rule, share: Number(sh.toFixed(2)) });
    } else if (rule === "high_energy_hours") {
      const hs = energyHours(all, tz); if (hs.length) out.push({ rule, hours: hs });
    }
  }
  return out.slice(0, cfg.mirror.patterns.max);
}

/** ط.4/ط.8: دليل وعي R1 = متوسط prediction_error على الفئات الثلاث (مصدر self). لا دليل سلبي من الواقع نفسه. */
export function predictionAwareness(preds: Array<{ category: string; predicted_hours: number; actual_hours: number }>): number | null {
  const vals = preds.filter((p) => p.predicted_hours > 0).map((p) => predictionValue(p.actual_hours, p.predicted_hours, cfg.evidence.R1.value.tolerance ?? scoring.value_defaults.prediction_tolerance));
  if (!vals.length) return null;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
}

/** ط.5: حارس النص — لا «ضيّعت» ولا مقارنة بالآخرين (الألوان في CSS: لا أحمر). */
export function forbiddenMirrorText(text: string): string | null {
  for (const p of cfg.mirror.forbid) { if (p === "red" || p === "comparison_with_others") continue; if (text.includes(p)) return p; }
  for (const p of ["غيرك", "الآخرين", "أحسن من", "أسوأ من"]) if (text.includes(p)) return "comparison_with_others";
  return null;
}

/** ط.4: اختيار 3 فئات للتوقّع: الأكبر والأهم لغاياته. */
export function pickPredictionCategories(dist: Record<string, number>, goalRelated: string[]): string[] {
  const n = cfg.prediction.categories;
  const out: string[] = [];
  for (const g of goalRelated) if (dist[g] !== undefined && out.length < n) out.push(g);
  for (const [k] of Object.entries(dist).filter(([k]) => k !== UNKNOWN).sort((a, b) => b[1] - a[1])) if (!out.includes(k) && out.length < n) out.push(k);
  return out;
}
export const noNegativeFromBehavior = !cfg.evidence.negative_from_behavior;
export const mirrorTitle = cfg.mirror.title_fixed;
