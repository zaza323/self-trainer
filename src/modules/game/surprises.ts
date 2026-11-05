import { game } from "@/shared/config";
import content from "@content/surprises.ar.json";
import type { AgeMode } from "@/shared/config";

/**
 * تعديل 0.3 §3: المفاجآت العشوائية — مولّد حتمي ببذرة mission_id حتى تعطي إعادة الحساب النتيجة نفسها حرفيًا.
 * لا شراء، لا ربط بسلسلة أيام، لا عرض للاحتمالات.
 */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type SurpriseKind = "cosmetic" | "xp_bonus" | "encouragement";
export type Surprise = { kind: SurpriseKind; payload: { icon?: string; xp?: number; text?: string }; rng_seed: string };
export type SurpriseInput = { missionId: string; stage: number; intensity: number; enabled: boolean; todayCount: number; weekCount: number; mode: AgeMode };

export function rollSurprise(i: SurpriseInput): Surprise | null {
  const c = game.surprises;
  if (!i.enabled || i.intensity < c.min_intensity) return null;
  if (i.todayCount >= c.daily_cap || i.weekCount >= c.weekly_cap) return null;
  const p = c.probability_by_stage[String(Math.min(4, Math.max(1, i.stage))) as "1" | "2" | "3" | "4"];
  if (p <= 0) return null;
  const seed = `surprise:${i.missionId}`;
  const rng = seededRng(hashSeed(seed));
  if (rng() >= p) return null;
  const k = rng();
  const kind: SurpriseKind = k < c.kinds.cosmetic ? "cosmetic" : k < c.kinds.cosmetic + c.kinds.xp_bonus ? "xp_bonus" : "encouragement";
  if (kind === "cosmetic") return { kind, payload: { icon: content.cosmetics[Math.floor(rng() * content.cosmetics.length)] }, rng_seed: seed };
  if (kind === "xp_bonus") { const [lo, hi] = c.xp_bonus_range; return { kind, payload: { xp: lo + Math.floor(rng() * (hi - lo + 1)) }, rng_seed: seed }; }
  const msgs = content.encouragement[i.mode];
  return { kind, payload: { text: msgs[Math.floor(rng() * msgs.length)] }, rng_seed: seed };
}
