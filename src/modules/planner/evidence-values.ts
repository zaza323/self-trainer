/** قيم أدلة المخطط الخفيفة (0.4 ج.8، د.7، ز.5، ط.8) — دوال نقية. لا قيمة سلبية في D1/D3/F1/M2 أبدًا. */
import { planner } from "@/shared/config";

const dm = planner.daily_moments as unknown as { evidence: { D1: { value: { all_done: number; half_or_more: number; less: number } }; D3: { value: { max: number; min: number; scale: string } } } };
const fu = planner.followup as unknown as { evidence: { F1: { value: number; min_support_level: string; rule_weight: number } } };
const mh = planner.daily_moments as unknown as { moments: { muhasaba: { shortfall_max_items: number } } };

/** D1: أولويات اليوم — أُنجزت كلها / نصفها فأكثر / أقل (0، لا سلبي). */
export function d1Value(planned: number, done: number): number | null {
  if (planned <= 0) return null;
  const v = dm.evidence.D1.value;
  if (done >= planned) return v.all_done;
  if (done / planned >= 0.5) return v.half_or_more;
  return v.less;
}

/** D3: خطة ليلية ثم إنجاز غدًا — نسبة المنجز × الحد الأعلى، بين min وmax. */
export function d3Value(planned: number, done: number): number | null {
  if (planned <= 0) return null;
  const v = dm.evidence.D3.value;
  return Math.max(v.min, Math.min(v.max, (done / planned) * v.max));
}

/** F1: بدأ التالي خلال transition_minutes بقراره (L2+) ⇒ +value؛ وإلا لا دليل. */
export function f1Value(startedWithinTransition: boolean, supportIndex: number, minSupportIndex: number): number | null {
  if (!startedWithinTransition || supportIndex < minSupportIndex) return null;
  return fu.evidence.F1.value;
}

/** M2: خطوة المحاسبة نُفذت في اليوم التالي ⇒ +0.6 (config)، لا سلبي. */
export function m2Value(executedNextDay: boolean, value: number): number | null { return executedNextDay ? value : null; }

export const muhasabaShortfallMax = mh.moments.muhasaba.shortfall_max_items;
