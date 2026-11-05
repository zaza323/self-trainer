import { customization, CONFIG_VERSION } from "@/shared/config";

/** فعالية القوالب (7.6، ADAPT-6) — دوال خالصة. */
export type MetricMission = { template_id: string; template_version: number; status: string; gate2: "shown" | "partial" | "not_yet" | null; prediction: { minutes?: number } | null; actual_duration_min: number | null; transferred: boolean };
export type TemplateMetrics = {
  template_id: string; template_version: number; missions_n: number;
  shown_rate: number; partial_rate: number; not_yet_rate: number; abandon_rate: number; transfer_rate: number;
  avg_prediction_error: number | null; flagged: boolean; flag_reasons: string[]; config_version: string;
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function templateMetricsFrom(missions: MetricMission[]): TemplateMetrics[] {
  const groups = new Map<string, MetricMission[]>();
  for (const m of missions) {
    if (!["completed", "abandoned", "reflected", "transferred"].includes(m.status)) continue;
    const k = `${m.template_id}|${m.template_version}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const cfg = customization.template_metrics;
  const out: TemplateMetrics[] = [];
  for (const ms of groups.values()) {
    const n = ms.length;
    const evaluated = ms.filter((m) => m.gate2);
    const rate = (f: (m: MetricMission) => boolean) => (evaluated.length ? evaluated.filter(f).length / evaluated.length : 0);
    const abandon = ms.filter((m) => m.status === "abandoned").length / n;
    const transfer = ms.filter((m) => m.transferred).length / n;
    const errs = ms.filter((m) => m.prediction?.minutes && m.actual_duration_min).map((m) => Math.abs(m.actual_duration_min! - m.prediction!.minutes!) / m.prediction!.minutes!);
    const shown = rate((m) => m.gate2 === "shown");
    const reasons: string[] = [];
    if (n >= cfg.min_missions_to_evaluate) {
      if (evaluated.length > 0 && shown < cfg.flag_if_shown_rate_below) reasons.push("low_shown");
      if (abandon > cfg.flag_if_abandon_rate_above) reasons.push("high_abandon");
    }
    out.push({
      template_id: ms[0]!.template_id, template_version: ms[0]!.template_version, missions_n: n,
      shown_rate: r3(shown), partial_rate: r3(rate((m) => m.gate2 === "partial")), not_yet_rate: r3(rate((m) => m.gate2 === "not_yet")),
      abandon_rate: r3(abandon), transfer_rate: r3(transfer), avg_prediction_error: errs.length ? r3(errs.reduce((a, b) => a + b, 0) / errs.length) : null,
      flagged: reasons.length > 0, flag_reasons: reasons, config_version: CONFIG_VERSION,
    });
  }
  return out.sort((a, b) => a.template_id.localeCompare(b.template_id) || a.template_version - b.template_version);
}
