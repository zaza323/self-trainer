/**
 * اقتراح أسبوع المرآة (0.4 ط.2، ط.6-5) — قواعد نقية. الفجوة: الالتزام < max_follow_through لأسبوعين أو تقصير متكرر
 * (times خلال days). مرة واحدة، والرفض يمنع التكرار reject_cooldown_days. الشهري حسب الإعداد. المتابعة بعد 2–4 أسابيع من تغيير مختار.
 */
import { planner } from "@/shared/config";
import { daysBetween } from "@/modules/planner/recurrence";

type Triggers = { gap: { max_follow_through: number; weeks: number; or_repeated_shortfall: { times: number; days: number }; suggest_once: boolean; reject_cooldown_days: number }; monthly: boolean; monthly_days: number };
const rm = planner.reality_mirror as unknown as { triggers: Triggers; planning: { follow_up_mirror_weeks: [number, number] } };
export const mirrorTriggers = rm.triggers;
export type SuggestionReason = "low_follow_through" | "repeated_shortfall" | "monthly" | "follow_up";
export type PastSuggestion = { reason: SuggestionReason; status: "pending" | "accepted" | "rejected" | "expired"; created_at: string; decided_at: string | null; follow_up_of?: string | null };

export type SuggestInput = {
  today: string;
  gapEnabled: boolean; monthlyEnabled: boolean;
  /** متوسط الالتزام لكل أسبوع، الأحدث آخرًا (null = لا بيانات) */
  weeklyFollowThrough: Array<number | null>;
  repeatedShortfall: boolean;
  past: PastSuggestion[];
  lastMirrorDate: string | null;
  /** آخر مرآة فيها تغيير مختار ولم تُتابع بعد */
  followUpCandidate: { id: string; date: string } | null;
};

export function lowFollowThrough(weekly: Array<number | null>): boolean {
  const g = rm.triggers.gap;
  const last = weekly.slice(-g.weeks);
  return last.length === g.weeks && last.every((v) => v !== null && v < g.max_follow_through);
}

/** يعيد سبب الاقتراح أو null. لا اقتراح فوق اقتراح معلّق. */
export function mirrorSuggestionDue(i: SuggestInput): { reason: SuggestionReason; followUpOf?: string } | null {
  if (i.past.some((p) => p.status === "pending")) return null;
  const g = rm.triggers.gap;
  const since = (d: string | null) => (d ? daysBetween(d.slice(0, 10), i.today) : Number.POSITIVE_INFINITY);
  const gapPast = i.past.filter((p) => p.reason === "low_follow_through" || p.reason === "repeated_shortfall");
  const rejectedRecently = gapPast.some((p) => p.status === "rejected" && since(p.decided_at ?? p.created_at) < g.reject_cooldown_days);
  const suggestedRecently = g.suggest_once && gapPast.some((p) => since(p.created_at) < g.reject_cooldown_days);
  if (i.gapEnabled && !rejectedRecently && !suggestedRecently) {
    if (lowFollowThrough(i.weeklyFollowThrough)) return { reason: "low_follow_through" };
    if (i.repeatedShortfall) return { reason: "repeated_shortfall" };
  }
  if (i.followUpCandidate) {
    const [minW, maxW] = rm.planning.follow_up_mirror_weeks;
    const d = since(i.followUpCandidate.date);
    const done = i.past.some((p) => p.reason === "follow_up" && p.follow_up_of === i.followUpCandidate!.id);
    if (!done && d >= minW * 7 && d <= maxW * 7) return { reason: "follow_up", followUpOf: i.followUpCandidate.id };
  }
  if (i.monthlyEnabled && rm.triggers.monthly && i.lastMirrorDate && since(i.lastMirrorDate) >= rm.triggers.monthly_days && !i.past.some((p) => p.reason === "monthly" && since(p.created_at) < rm.triggers.monthly_days)) return { reason: "monthly" };
  return null;
}

/** ط.6-5: «قبل شهر الجوال بعد العشا ساعتين، هلق ساعة» — مقارنة توزيع بتوزيع (دقائق/يوم ⇒ ساعات). */
export function compareDistributions(before: Record<string, number>, now: Record<string, number>, top: number): Array<{ category: string; before: number; now: number }> {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(now)])];
  return keys.map((k) => ({ category: k, before: (before[k] ?? 0) / 60, now: (now[k] ?? 0) / 60 }))
    .sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before)).slice(0, top);
}
