/**
 * مستويات الدعم (أ.5) ومستويات التدريب (أ.6) والفحص الدوري للمتقن — دوال نقية.
 */
import { support, SUPPORT_LEVELS, type SupportLevel, type TrainingLevel } from "@/shared/config";

export type CapMissionSummary = {
  gate2: "shown" | "partial" | "not_yet" | null;
  abandoned: boolean;          // gate1 = false
  hints_used: number;
  training_level: TrainingLevel;
  is_mastery_check?: boolean;
};

const idx = (l: SupportLevel) => SUPPORT_LEVELS.indexOf(l);
const at = (i: number): SupportLevel => SUPPORT_LEVELS[Math.min(SUPPORT_LEVELS.length - 1, Math.max(0, i))]!;

export type SupportDecision = { level: SupportLevel; change: "up" | "down" | "none"; reason: string };

/**
 * أ.5 — تُقيَّم عند كل reflected لمهمة وزن القدرة فيها ≥ الحد.
 * recent: مهام هذه القدرة الأحدث أولًا (تشمل المهمة الحالية). missionsSinceChange: عدد مهام القدرة منذ آخر تغيير.
 */
export function decideSupport(current: SupportLevel, recent: CapMissionSummary[], missionsSinceChange: number, confidence: number): SupportDecision {
  const p = support.promote, d = support.demote;
  const winP = recent.slice(0, p.window_missions);
  const shown = winP.filter((m) => m.gate2 === "shown").length;
  const hints = winP.reduce((s, m) => s + m.hints_used, 0);
  const abandoned = winP.filter((m) => m.abandoned).length;
  const winD = recent.slice(0, d.window_missions);
  const struggles = winD.filter((m) => (d.struggle_states.includes("gate2_not_yet") && m.gate2 === "not_yet") || (d.struggle_states.includes("abandoned") && m.abandoned)).length;
  if (struggles >= d.min_struggles && missionsSinceChange >= d.min_missions_since_last_change && idx(current) > 0) {
    return { level: at(idx(current) - 1), change: "down", reason: "struggle" };
  }
  if (shown >= p.min_gate2_shown && hints <= p.max_total_hints && abandoned <= p.max_abandoned && confidence >= p.min_confidence && missionsSinceChange >= p.min_missions_since_last_change && idx(current) < SUPPORT_LEVELS.length - 1) {
    return { level: at(idx(current) + 1), change: "up", reason: "consistent_shown" };
  }
  return { level: current, change: "none", reason: "" };
}

export type TrainingDecision = { level: TrainingLevel; mastered: boolean; change: boolean; reason: string };

/** أ.6 — "مهمة لهذه القدرة" = القدرة هي الأعلى وزنًا في قالبها. لا خفض تلقائي. */
export function decideTraining(args: {
  current: TrainingLevel;
  mastered: boolean;
  missions: CapMissionSummary[];               // مهام القدرة (الأعلى وزنًا) المتأمَّلة
  supportLevel: SupportLevel;
  score: number;
  confidence: number;
  transferReports: Array<{ worked: boolean; context_tag: string }>;
}): TrainingDecision {
  const a = support.training_levels.advance;
  const shownAt = (lvl: TrainingLevel) => args.missions.filter((m) => m.training_level === lvl && m.gate2 === "shown").length;
  const worked = args.transferReports.filter((r) => r.worked);
  if (args.mastered) return { level: args.current, mastered: true, change: false, reason: "" };
  if (args.current === "simulated" && shownAt("simulated") >= a.simulated_to_guided_real.min_shown && args.confidence >= a.simulated_to_guided_real.min_confidence) {
    return { level: "guided_real", mastered: false, change: true, reason: "simulated_shown" };
  }
  if (args.current === "guided_real" && shownAt("guided_real") >= a.guided_real_to_independent_real.min_shown && idx(args.supportLevel) >= idx(a.guided_real_to_independent_real.min_support_level)) {
    return { level: "independent_real", mastered: false, change: true, reason: "guided_shown" };
  }
  if (args.current === "independent_real" && shownAt("independent_real") >= a.independent_real_to_transfer.min_shown && worked.length >= a.independent_real_to_transfer.min_worked_transfer_reports) {
    return { level: "transfer", mastered: false, change: true, reason: "independent_shown" };
  }
  if (args.current === "transfer") {
    const t = a.transfer_to_mastered;
    const ctx = new Set(worked.map((r) => r.context_tag)).size;
    if (worked.length >= t.min_worked_transfer_reports && ctx >= t.min_distinct_contexts && args.score >= t.min_score && args.confidence >= t.min_confidence && args.supportLevel === t.required_support_level) {
      return { level: "transfer", mastered: true, change: true, reason: "mastered" };
    }
  }
  return { level: args.current, mastered: false, change: false, reason: "" };
}

/** الفحص الدوري للمتقن (5.4): shown → يبقى؛ غير ذلك → يعود independent_real وينخفض الدعم درجة (بحد أدنى). */
export function applyMasteryCheck(result: "shown" | "partial" | "not_yet", supportLevel: SupportLevel): { mastered: boolean; training_level: TrainingLevel; support_level: SupportLevel } {
  const f = support.mastery_check.on_fail;
  if (result === "shown") return { mastered: true, training_level: "transfer", support_level: supportLevel };
  const lowered = at(Math.max(idx(f.support_level_floor), idx(supportLevel) + f.support_level_delta));
  return { mastered: false, training_level: f.set_training_level, support_level: lowered };
}

/** موعد الفحص القادم: كل interval ± jitter (حتمي من معرّف الملف والتاريخ). */
export function nextMasteryCheckDate(from: Date, seed: string): string {
  const m = support.mastery_check;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const jitter = (h % (2 * m.jitter_days + 1)) - m.jitter_days;
  const d = new Date(from.getTime() + (m.interval_days + jitter) * 86400000);
  return d.toISOString().slice(0, 10);
}

/** مستوى الدعم الفعّال مع تجاوز المربي المؤقت (4.9): أدنى الاثنين حتى انتهاء المدة. */
export function effectiveSupport(level: SupportLevel, override: { level: SupportLevel; until: string } | null, now: Date): SupportLevel {
  if (!override || new Date(override.until) < now) return level;
  return at(Math.min(idx(level), idx(override.level)));
}
