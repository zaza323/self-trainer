import { trial, CAPABILITY_IDS, SUPPORT_LEVELS, type AgeMode, type SupportLevel } from "@/shared/config";

/**
 * مقاييس النجاح (القسم 15) والتحذيران المضادان — دوال خالصة على بيانات مجمّعة لكل مشارك.
 * التفسيرات الكمية (نسبة المستخدمين، نوافذ المقارنة) من config/trial.json وموثقة في README.
 */
export type ParticipantData = {
  profile_id: string;
  age_mode: AgeMode;
  joined_at: string;
  missions: Array<{ completed_at: string; gate1: boolean | null; gate2: "shown" | "partial" | "not_yet" | null; has_transfer: boolean; is_real: boolean }>;
  scoresWeek: Record<number, Partial<Record<string, number>>>;     // درجة كل قدرة في أسبوع (آخر لقطة في ذلك الأسبوع)
  supportStart: Partial<Record<string, SupportLevel>>;
  supportEnd: Partial<Record<string, SupportLevel>>;
  helpNeededWeek: Record<number, number | null>;                   // متوسط قيمة دليل help_needed في الأسبوع
  evidenceNovel: number[];                                         // قيم الأدلة في سياق جديد
  evidenceUsual: number[];                                         // قيم الأدلة في السياقات المعتادة
  activeDays: string[];                                            // أيام فيها نشاط (YYYY-MM-DD)
  suggestions: { decided: number; accepted: number };
  xpWeek: Record<number, number>;
  rewardDeliveries: Array<{ at: string }>;
  focusCapabilities: string[];                                     // القدرات المستهدفة (إعداد focus أو كل القدرات)
};
export type MetricStatus = { key: string; value: number | null; target: number | null; met: boolean | null; n: number; note?: string };
export type Warning = { key: "xp_without_learning" | "reward_displaces_motivation"; profiles: number; detail: Record<string, unknown> };
export type CohortMetrics = { metrics: MetricStatus[]; warnings: Warning[]; participants: number; by_mode: Record<string, number> };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const weekOf = (joinedAt: string, at: string) => Math.floor((Date.parse(at) - Date.parse(joinedAt)) / (7 * 86400000)) + 1;
const supIdx = (l?: SupportLevel) => (l ? SUPPORT_LEVELS.indexOf(l) : -1);

export function skillGrowth(ps: ParticipantData[]): MetricStatus {
  const c = trial.metrics.skill_growth;
  const [w1, w4] = c.compare_weeks;
  const qualifying = ps.filter((p) => p.missions.length >= c.min_missions && p.scoresWeek[w1!] && p.scoresWeek[w4!]);
  const meeting = qualifying.filter((p) => {
    const caps = p.focusCapabilities.length ? p.focusCapabilities : [...CAPABILITY_IDS];
    const improved = caps.filter((cap) => (p.scoresWeek[w4!]?.[cap] ?? 0) > (p.scoresWeek[w1!]?.[cap] ?? 0)).length;
    return improved >= c.min_capabilities_improved;
  });
  const value = qualifying.length ? r3(meeting.length / qualifying.length) : null;
  return { key: "skill_growth", value, target: c.min_share_of_qualifying_users, met: value === null ? null : value >= c.min_share_of_qualifying_users, n: qualifying.length };
}

export function transferRate(ps: ParticipantData[]): MetricStatus {
  const all = ps.flatMap((p) => p.missions.filter((m) => m.is_real));
  const value = all.length ? r3(all.filter((m) => m.has_transfer).length / all.length) : null;
  return { key: "transfer_rate", value, target: trial.metrics.transfer_rate.target, met: value === null ? null : value >= trial.metrics.transfer_rate.target, n: all.length };
}

export function autonomy(ps: ParticipantData[]): MetricStatus {
  const c = trial.metrics.autonomy;
  const withData = ps.filter((p) => Object.keys(p.supportStart).length > 0);
  const meeting = withData.filter((p) => CAPABILITY_IDS.some((cap) => supIdx(p.supportEnd[cap]) - supIdx(p.supportStart[cap]) >= c.min_support_levels_up));
  const value = withData.length ? r3(meeting.length / withData.length) : null;
  const help = ps.map((p) => { const ws = Object.keys(p.helpNeededWeek).map(Number).sort((a, b) => a - b); const a = p.helpNeededWeek[ws[0]!], b = p.helpNeededWeek[ws[ws.length - 1]!]; return a !== null && a !== undefined && b !== null && b !== undefined && ws.length > 1 ? b - a : null; }).filter((x): x is number => x !== null);
  return { key: "autonomy", value, target: c.min_share_of_users, met: value === null ? null : value >= c.min_share_of_users, n: withData.length, note: help.length ? `help_needed_delta_mean=${r3(mean(help)!)}` : undefined };
}

/** نسبة "أنجز وأتقن" (shown) إلى "أنجز فقط" (gate1 بلا shown): اتجاه صاعد بين الأسبوعين. */
export function masteryOverAchievement(ps: ParticipantData[]): MetricStatus {
  const [w1, w4] = trial.metrics.mastery_over_achievement.compare_weeks;
  const ratio = (w: number) => {
    const ms = ps.flatMap((p) => p.missions.filter((m) => m.gate1 && weekOf(p.joined_at, m.completed_at) === w));
    const shown = ms.filter((m) => m.gate2 === "shown").length, only = ms.length - shown;
    return ms.length ? shown / Math.max(1, only) : null;
  };
  const a = ratio(w1!), b = ratio(w4!);
  const value = a !== null && b !== null ? r3(b - a) : null;
  return { key: "mastery_over_achievement", value, target: 0, met: value === null ? null : value > 0, n: ps.length, note: a !== null && b !== null ? `w${w1}=${r3(a)} w${w4}=${r3(b)}` : undefined };
}

export function novelContext(ps: ParticipantData[]): MetricStatus {
  const novel = ps.flatMap((p) => p.evidenceNovel), usual = ps.flatMap((p) => p.evidenceUsual);
  const mn = mean(novel), mu = mean(usual);
  if (mn === null || mu === null) return { key: "novel_context", value: null, target: trial.metrics.novel_context.max_relative_gap, met: null, n: novel.length };
  const gap = r3(Math.abs(mn - mu) / Math.max(Math.abs(mu), 0.1));
  return { key: "novel_context", value: gap, target: trial.metrics.novel_context.max_relative_gap, met: gap <= trial.metrics.novel_context.max_relative_gap, n: novel.length };
}

export function healthyReturn(ps: ParticipantData[], now: Date): MetricStatus[] {
  const c = trial.metrics.healthy_return;
  return c.after_days.map((d) => {
    const eligible = ps.filter((p) => (now.getTime() - Date.parse(p.joined_at)) / 86400000 >= d);
    const returned = eligible.filter((p) => p.activeDays.some((day) => (Date.parse(day) - Date.parse(p.joined_at)) / 86400000 >= d));
    const target = (c.targets as Record<string, number>)[String(d)] ?? 0;
    const value = eligible.length ? r3(returned.length / eligible.length) : null;
    return { key: `return_${d}`, value, target, met: value === null ? null : value >= target, n: eligible.length };
  });
}

export function adaptationAcceptance(ps: ParticipantData[]): MetricStatus {
  const decided = ps.reduce((s, p) => s + p.suggestions.decided, 0), accepted = ps.reduce((s, p) => s + p.suggestions.accepted, 0);
  const value = decided ? r3(accepted / decided) : null;
  return { key: "adaptation_acceptance", value, target: trial.metrics.adaptation_acceptance.target, met: value === null ? null : value >= trial.metrics.adaptation_acceptance.target, n: decided };
}

/** تحذير مضاد 1: XP يرتفع والقدرات ثابتة. */
export function warnXpWithoutLearning(ps: ParticipantData[]): Warning | null {
  const c = trial.counter_warnings.xp_without_learning;
  const [w1, w4] = trial.metrics.skill_growth.compare_weeks;
  const hit = ps.filter((p) => {
    const x1 = p.xpWeek[w1!] ?? 0, x4 = p.xpWeek[w4!] ?? 0;
    if (x1 <= 0 || (x4 - x1) / x1 < c.min_xp_growth_ratio) return false;
    const deltas = CAPABILITY_IDS.map((cap) => (p.scoresWeek[w4!]?.[cap] ?? 0) - (p.scoresWeek[w1!]?.[cap] ?? 0)).filter((d) => !Number.isNaN(d));
    const avg = mean(deltas);
    return avg !== null && Math.abs(avg) <= c.max_avg_capability_delta && p.scoresWeek[w1!] !== undefined && p.scoresWeek[w4!] !== undefined;
  });
  return hit.length ? { key: "xp_without_learning", profiles: hit.length, detail: { of: ps.length } } : null;
}

/** تحذير مضاد 2: نسبة shown تنخفض في الأسبوعين التاليين لتسليم مكافأة واقعية. */
export function warnRewardDisplacesMotivation(ps: ParticipantData[]): Warning | null {
  const c = trial.counter_warnings.reward_displaces_motivation;
  const win = c.window_days * 86400000;
  let hits = 0, deliveries = 0;
  for (const p of ps) for (const d of p.rewardDeliveries) {
    const t = Date.parse(d.at);
    const before = p.missions.filter((m) => Date.parse(m.completed_at) < t && Date.parse(m.completed_at) >= t - win && m.gate2);
    const after = p.missions.filter((m) => Date.parse(m.completed_at) >= t && Date.parse(m.completed_at) < t + win && m.gate2);
    if (before.length < c.min_missions_each_window || after.length < c.min_missions_each_window) continue;
    deliveries++;
    const rb = before.filter((m) => m.gate2 === "shown").length / before.length, ra = after.filter((m) => m.gate2 === "shown").length / after.length;
    if (rb - ra >= c.min_shown_rate_drop) hits++;
  }
  return hits ? { key: "reward_displaces_motivation", profiles: hits, detail: { deliveries_evaluated: deliveries } } : null;
}

export function computeCohortMetrics(ps: ParticipantData[], now = new Date()): CohortMetrics {
  const by_mode: Record<string, number> = {};
  for (const p of ps) by_mode[p.age_mode] = (by_mode[p.age_mode] ?? 0) + 1;
  const warnings = [warnXpWithoutLearning(ps), warnRewardDisplacesMotivation(ps)].filter((w): w is Warning => w !== null);
  return { participants: ps.length, by_mode, metrics: [skillGrowth(ps), transferRate(ps), autonomy(ps), masteryOverAchievement(ps), novelContext(ps), ...healthyReturn(ps, now), adaptationAcceptance(ps)], warnings };
}
