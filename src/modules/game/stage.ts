/**
 * مراحل الحوافز وكثافة اللعبة (الملحق أ.7) — دوال نقية. كل الأرقام من config/game.json.
 */
import { game, SUPPORT_LEVELS, type AgeMode, type SupportLevel, type TrainingLevel } from "@/shared/config";

export type IncentiveStage = 1 | 2 | 3 | 4;
const LEVEL_ORDER: TrainingLevel[] = ["simulated", "guided_real", "independent_real", "transfer"];

export type StageInput = {
  stage: IncentiveStage;
  daysSinceOnboarding: number;
  reflectedMissions: number;
  selfCreatedReflectedMissions: number;
  transferReports: number;
  transferReportsLast30Days: number;
  capabilities: Array<{ confidence: number; support_level: SupportLevel; training_level: TrainingLevel; mastered: boolean }>;
};

/** متوسط مؤشر الدعم على القدرات النشطة (ثقتها ≥ الحد). إن لم توجد → 0. */
export function avgSupport(caps: StageInput["capabilities"]): number {
  const active = caps.filter((c) => c.confidence >= game.incentive_stages.active_capability_min_confidence);
  if (active.length === 0) return 0;
  return active.reduce((s, c) => s + SUPPORT_LEVELS.indexOf(c.support_level), 0) / active.length;
}

/** انتقال مرحلة واحدة كحد أقصى في كل تقييم؛ لا تراجع تلقائي. */
export function nextStage(i: StageInput): IncentiveStage {
  const a = game.incentive_stages.advance;
  const avg = avgSupport(i.capabilities);
  if (i.stage === 1) {
    const r = a["1_attract_to_2_competence"];
    const withConf = i.capabilities.filter((c) => c.confidence >= game.incentive_stages.active_capability_min_confidence).length;
    if (i.daysSinceOnboarding >= r.min_days_since_onboarding && i.reflectedMissions >= r.min_reflected_missions && withConf >= r.min_capabilities_with_confidence) return 2;
    return 1;
  }
  if (i.stage === 2) {
    const r = a["2_competence_to_3_meaning"];
    if (avg >= r.min_avg_support && i.selfCreatedReflectedMissions >= r.min_self_created_reflected_missions && i.transferReports >= r.min_transfer_reports) return 3;
    return 2;
  }
  if (i.stage === 3) {
    const r = a["3_meaning_to_4_autonomy"];
    const minIdx = LEVEL_ORDER.indexOf(r.min_capabilities_at_or_above.level);
    const atLevel = i.capabilities.filter((c) => c.mastered || LEVEL_ORDER.indexOf(c.training_level) >= minIdx).length;
    if (avg >= r.min_avg_support && atLevel >= r.min_capabilities_at_or_above.count && i.transferReportsLast30Days >= r.min_transfer_reports_last_30_days) return 4;
    return 3;
  }
  return 4;
}

/** intensity = clamp(round((base − penalty × avg_support) × age_factor), 0, 100)؛ تجاوز يدوي للأوضاع المسموحة فقط. */
export function computeIntensity(stage: IncentiveStage, avg: number, ageMode: AgeMode, manualOverride: number | null): number {
  const c = game.intensity;
  if (manualOverride !== null && c.manual_override_age_modes.includes(ageMode)) return Math.min(100, Math.max(0, Math.round(manualOverride)));
  const base = c.base_by_stage[String(stage) as "1" | "2" | "3" | "4"];
  return Math.min(100, Math.max(0, Math.round((base - c.avg_support_penalty_per_level * avg) * c.age_factor[ageMode])));
}

export type GameElement = "avatar_and_space" | "achievement_badges" | "celebration_subtle" | "xp_number_and_level_bar" | "celebration_full" | "collectibles_and_unlocks";
export const GAME_ELEMENTS: GameElement[] = ["avatar_and_space", "achievement_badges", "celebration_subtle", "xp_number_and_level_bar", "celebration_full", "collectibles_and_unlocks"];

/** جدول أ.7: ما يظهر عند كل كثافة. عند 0 يختفي كل شيء؛ شاشة الوعي بالتقدم النصية ليست عنصرًا لعبيًا ولا تمر من هنا. */
export function visibleElements(intensity: number, stage: IncentiveStage): Set<GameElement> {
  const th = game.intensity.element_thresholds;
  const out = new Set<GameElement>();
  if (intensity <= 0) return out;
  if (intensity >= th.avatar_and_space) out.add("avatar_and_space");
  if (intensity >= th.achievement_badges) out.add("achievement_badges");
  if (intensity >= th.celebration_subtle) out.add("celebration_subtle");
  if (intensity >= th.xp_number_and_level_bar) out.add("xp_number_and_level_bar");
  if (intensity >= th.celebration_full) out.add("celebration_full");
  if (intensity >= th.collectibles_and_unlocks.min_intensity && th.collectibles_and_unlocks.allowed_stages.includes(stage)) out.add("collectibles_and_unlocks");
  return out;
}
