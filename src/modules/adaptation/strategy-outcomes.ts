import { customization, SUPPORT_LEVELS, type AgeMode, type SupportLevel } from "@/shared/config";
import content from "@content/adaptation.ar.json";

/**
 * ذاكرة الاستراتيجيات (4.13.2، ADAPT-3) — دوال خالصة.
 * الجدول محسوب من المهام والأدلة (gate2) لا من نصوص المحادثات.
 */
export type OutcomeMission = { mechanic: string; strategy_chosen: string | null; custom_strategy_label: string | null; custom_strategy: string | null; gate2: "shown" | "partial" | "not_yet" | null; completed_at: string | null };
export type StrategyOutcomeRow = { mechanic_id: string; strategy_key: string; strategy_label: string | null; uses: number; shown_count: number; partial_count: number; last_used_at: string | null };

/** مفتاح الاستراتيجية: معرّف استراتيجية القالب، أو التسمية الموحدة للمخصصة (strategy_normalizer)، أو "custom". */
export function strategyKeyOf(m: Pick<OutcomeMission, "strategy_chosen" | "custom_strategy_label" | "custom_strategy">): string | null {
  if (m.strategy_chosen) return m.strategy_chosen;
  if (m.custom_strategy) return `custom:${(m.custom_strategy_label ?? "custom").trim().toLowerCase()}`;
  return null;
}

export function computeStrategyOutcomes(missions: OutcomeMission[]): StrategyOutcomeRow[] {
  const map = new Map<string, StrategyOutcomeRow>();
  for (const m of missions) {
    if (!m.gate2) continue; // لم تُقيَّم بعد
    const key = strategyKeyOf(m);
    if (!key) continue;
    const id = `${m.mechanic}|${key}`;
    const row = map.get(id) ?? { mechanic_id: m.mechanic, strategy_key: key, strategy_label: m.custom_strategy_label ?? null, uses: 0, shown_count: 0, partial_count: 0, last_used_at: null };
    row.uses++;
    if (m.gate2 === "shown") row.shown_count++;
    if (m.gate2 === "partial") row.partial_count++;
    if (m.completed_at && (!row.last_used_at || m.completed_at > row.last_used_at)) row.last_used_at = m.completed_at;
    map.set(id, row);
  }
  return [...map.values()].sort((a, b) => a.mechanic_id.localeCompare(b.mechanic_id) || a.strategy_key.localeCompare(b.strategy_key));
}

export const shownRate = (r: StrategyOutcomeRow) => (r.uses ? r.shown_count / r.uses : 0);

/** عند L0–L1: الاستراتيجية الأنجح (حد أدنى للاستخدام ونسبة الظهور من config). */
export function bestStrategy(rows: StrategyOutcomeRow[], mechanic: string): StrategyOutcomeRow | null {
  const cfg = customization.strategy_memory;
  const cands = rows.filter((r) => r.mechanic_id === mechanic && r.uses >= cfg.min_uses_to_show && shownRate(r) >= cfg.min_shown_rate_to_show);
  cands.sort((a, b) => shownRate(b) - shownRate(a) || b.uses - a.uses);
  return cands[0] ?? null;
}

/** هل يُعرض وسم "نجحت معك سابقًا" في التخطيط عند هذا المستوى من الدعم؟ (L0–L1) */
export function showMemoryInPlanning(level: SupportLevel): boolean {
  return SUPPORT_LEVELS.indexOf(level) <= SUPPORT_LEVELS.indexOf(customization.strategy_memory.show_in_planning_up_to_support_level);
}

/** عند L2–L3: المرافق يستحضر آخر استراتيجية في التأمل فقط. */
export function recallLine(rows: StrategyOutcomeRow[], mechanic: string, mode: AgeMode, labelFor: (key: string) => string): string | null {
  const used = rows.filter((r) => r.mechanic_id === mechanic && r.uses > 0 && r.last_used_at);
  used.sort((a, b) => (b.last_used_at! > a.last_used_at! ? 1 : -1));
  const last = used[0];
  if (!last) return null;
  const rate = shownRate(last);
  const outcome = rate >= customization.strategy_memory.min_shown_rate_to_show ? "shown" : last.partial_count > 0 ? "partial" : "not_yet";
  return content.strategy_memory.recall[mode].replace("{strategy}", labelFor(last.strategy_key)).replace("{outcome}", content.strategy_memory.outcomes[outcome]);
}
