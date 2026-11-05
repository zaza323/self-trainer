/**
 * حساب XP لمهمة (الملحق أ.8) — دالة نقية. الكتابة في xp_events (append-only، UNIQUE(reason, source_id)).
 * العرض (الرقم وشريط المستوى) يخضع لكثافة اللعبة في المرحلة 3؛ هنا الحساب فقط.
 */
import { game, type SupportLevel, type TrainingLevel } from "@/shared/config";

export type XpInput = {
  gate1: boolean;
  gate2: "shown" | "partial" | "not_yet";
  difficulty: number;
  trainingLevel: TrainingLevel;
  incentiveStage: number;
  primaryCapabilitySupport: SupportLevel;
  isMasteryCheck?: boolean;
};

export type XpAward = { reason: string; amount: number };

export function missionXp(i: XpInput): XpAward[] {
  const r = game.xp.rewards;
  const f = game.xp.fading;
  const awards: XpAward[] = [];
  const simulatedZero = i.incentiveStage >= f.simulated_zero_from_stage && i.trainingLevel === "simulated";
  const gate1Zero = i.incentiveStage >= f.gate1_zero_when.min_stage && i.primaryCapabilitySupport === f.gate1_zero_when.primary_capability_support_level;
  const z = (n: number) => (simulatedZero ? 0 : n);
  if (i.gate1) awards.push({ reason: "gate1_pass", amount: z(gate1Zero ? 0 : r.gate1_pass.base + r.gate1_pass.per_difficulty_above_1 * (i.difficulty - 1)) });
  awards.push({ reason: `gate2_${i.gate2}`, amount: z(i.gate2 === "shown" ? r.gate2_shown : i.gate2 === "partial" ? r.gate2_partial : r.gate2_not_yet) });
  awards.push({ reason: "reflection_done", amount: z(r.reflection_done) });
  if (i.isMasteryCheck && i.gate2 === "shown") awards.push({ reason: "mastery_check_pass", amount: r.mastery_check_pass });
  return awards.filter((a) => a.amount > 0);
}

export const totalXp = (awards: XpAward[]) => awards.reduce((s, a) => s + a.amount, 0);

/** السقف اليومي: يقصّ المبالغ بالترتيب حتى لا يتجاوز المجموع اليومي الحد. */
export function applyDailyCap(awards: XpAward[], alreadyToday: number): XpAward[] {
  let room = Math.max(0, game.xp.daily_cap - alreadyToday);
  return awards.map((a) => { const amount = Math.min(a.amount, room); room -= amount; return { ...a, amount }; }).filter((a) => a.amount > 0);
}

/** المستوى التجميلي: المستوى n يتطلب مجموعًا = 50·n·(n+1) — الصيغة في game.json.level_formula */
export function levelForXp(total: number): number {
  let n = 0;
  while (50 * (n + 1) * (n + 2) <= total) n++;
  return n;
}
