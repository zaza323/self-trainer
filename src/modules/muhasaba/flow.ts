/**
 * محاسبة النفس (0.4 ز) — قواعد نقية: الخطوات الثلاث (أنجزت ← قصّرت ← المرة القادمة)، تنتهي دائمًا بالخطوة القادمة،
 * التقصير سلوك لا هوية، حد 3 بنود، يوم الاستراحة بلا خطوة تقصير، صيغة الطفل بسؤالين.
 */
import { planner, type AgeMode } from "@/shared/config";
import content from "@content/muhasaba.ar.json";

const cfg = (planner.daily_moments as unknown as { moments: { muhasaba: { steps: string[]; reply_moments: string[]; shortfall_max_items: number; must_end_on: string; rest_day_skip: string[]; child_steps: string[]; target_minutes: [number, number]; next_becomes_morning_priorities: boolean; recurring_shortfall: { times: number; days: number; raise_in_weekly_review: boolean } } } }).moments.muhasaba;
export const muhasabaConfig = cfg;

export type MuhasabaStep = "achieved" | "shortfall" | "next" | "did_well" | "do_better_tomorrow";

/** ز.3: الخطوات حسب الوضع ويوم الاستراحة. */
export function stepsFor(ageMode: AgeMode, restDay: boolean): MuhasabaStep[] {
  if (ageMode === "child") return cfg.child_steps as MuhasabaStep[];
  const steps = cfg.steps as MuhasabaStep[];
  return restDay ? steps.filter((s) => !cfg.rest_day_skip.includes(s)) : steps;
}

/** الجلسة تنتهي دائمًا على الخطوة القادمة. */
export function lastStep(ageMode: AgeMode): MuhasabaStep { return ageMode === "child" ? "do_better_tomorrow" : (cfg.must_end_on as MuhasabaStep); }

/** نوع لحظة الرد لكل خطوة (أ.2). */
export function replyMomentFor(step: MuhasabaStep): string {
  const i = (cfg.steps as string[]).indexOf(step);
  if (i >= 0) return cfg.reply_moments[i] ?? "free_chat";
  return step === "did_well" ? "reflection_secondary" : "priority_pick";
}

export type Shortfall = { text: string; reason: string | null; task_id: string | null };

/** ز.2: حد أقصى 3 بنود، وسبب مكتوب لواحد منها على الأقل حين توجد بنود. */
export function validateShortfalls(items: Shortfall[]): { ok: true } | { ok: false; reason: "too_many" | "reason_required" } {
  if (items.length > cfg.shortfall_max_items) return { ok: false, reason: "too_many" };
  if (items.length > 0 && !items.some((s) => s.reason && s.reason.trim().length > 0)) return { ok: false, reason: "reason_required" };
  return { ok: true };
}

const BLAME = (content.self_blame_patterns as string[]).map((p) => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

/** جلد الذات: «أنا فاشل»، «ما بنفع لشي»… */
export function isSelfBlame(text: string): boolean { return BLAME.some((re) => re.test(text)); }

/** رد ثابت يعكس الكلام بلطف ويعيده للسلوك المحدد (ز.2). */
export function reframeLine(ageMode: AgeMode, behavior: string | null): string {
  const tpl = (content.reframe as Record<AgeMode, string>)[ageMode];
  return tpl.replace("{behavior}", behavior?.trim() || (content.reframe_default_behavior as string));
}

/** هل يؤكد رد المرافق الحكم على الهوية؟ (للتحقق من مخرج النموذج في جلسات المحاسبة) */
export function replyAffirmsBlame(reply: string): boolean {
  return (content.affirming_patterns as string[]).some((p) => reply.includes(p));
}

/** ز.4: تكرار التقصير نفسه (المهمة أو الوسم) N مرات في M يومًا. */
export function recurringShortfalls(entries: Array<{ local_date: string; shortfalls: Shortfall[] }>, today: string): Array<{ key: string; times: number }> {
  const since = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - cfg.recurring_shortfall.days)).toISOString().slice(0, 10);
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.local_date < since) continue;
    for (const s of e.shortfalls) { const k = s.task_id ?? s.text.trim(); counts.set(k, (counts.get(k) ?? 0) + 1); }
  }
  return [...counts.entries()].filter(([, n]) => n >= cfg.recurring_shortfall.times).map(([key, times]) => ({ key, times }));
}
export const nextBecomesMorningPriorities = cfg.next_becomes_morning_priorities;
