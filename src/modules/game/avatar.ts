/** نمو المساحة الشخصية (GAME-1، أ.8): مرتبط بمستويات التدريب لا بالـXP ولا بعدد المهام، ولا يتراجع أبدًا. */
import { game, type TrainingLevel } from "@/shared/config";

export function avatarPoints(caps: Array<{ training_level: TrainingLevel; mastered: boolean }>): number {
  const p = game.avatar.training_level_points;
  return caps.reduce((s, c) => s + (c.mastered ? p.mastered : p[c.training_level]), 0);
}

/** avatar_stage = أكبر i حيث points ≥ thresholds[i] → 1..6 */
export function avatarStage(points: number): number {
  const th = game.avatar.stage_thresholds;
  let stage = 1;
  th.forEach((t, i) => { if (points >= t) stage = i + 1; });
  return stage;
}

/** لا تتراجع: تُعرض أعلى مرحلة بلغها المستخدم. */
export function displayedAvatarStage(computed: number, storedMax: number): number {
  return Math.max(computed, storedMax, 1);
}
