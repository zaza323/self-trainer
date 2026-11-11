/**
 * محرك التخصيص بالقواعد الثابتة (ENGINE-1، ENGINE-3، ENGINE-6) — دالة نقية حتمية.
 * المرحلة 2: يقرأ مستوى التدريب والدعم من capability_states، يستثني المتقن (5.4)،
 * يفضّل القدرات المركّز عليها وإلا أضعف قدرة بثقة كافية، يكيّف الصعوبة (ENGINE-3)،
 * ويجدول فحص الإتقان الدوري، ومهمة إحماء واحدة أسبوعيًا من المستوى الأدنى (أ.6).
 */
import { limits, scoring, support, game, type AgeMode, type SupportLevel, type TrainingLevel, type CapabilityId } from "@/shared/config";
import { primaryCapability, textByMode, type MissionTemplate } from "@/modules/library";
import defaultVariables from "@content/default_variables.ar.json";

export type HistoryItem = {
  template_id: string;
  mechanic: string;
  primary_capability: string;
  training_level: TrainingLevel;
  status: string;
  gate1: boolean | null;
  gate2?: "shown" | "partial" | "not_yet" | null;
  hints_used?: number;
  difficulty?: number;
  suggested_for: string; // YYYY-MM-DD
  dismissed?: boolean;
  is_mastery_check?: boolean;
};

export type CapabilityStateLite = {
  capability_id: string;
  training_level: TrainingLevel;
  support_level: SupportLevel;
  mastered: boolean;
  next_mastery_check_at: string | null;
  score?: number;
  confidence?: number;
};

export type SelectInput = {
  ageMode: AgeMode;
  today: string;
  templates: MissionTemplate[];
  history: HistoryItem[];
  states: CapabilityStateLite[];
  focusCapabilities: CapabilityId[];
  dailyCount: number;
  breakMode: boolean;
  /** اقتراح تكيّف مقبول «جرّب ميكانيكية» لأسبوع (7.6) */
  mechanicHint?: string | null;
};

export type Suggestion = {
  template: MissionTemplate;
  difficulty: number;
  support_level: SupportLevel;
  variables: Record<string, string | number>;
  rationale: string;
  is_mastery_check: boolean;
  /** 0.5 أ.5: مصدر الموقف من حياة المستخدم (يحدده الخادم أو يقبله من قائمة أعطاها) */
  life_source?: { ref_type: "planner_task" | "life_entry" | "user_typed"; ref_id: string | null; text: string };
};

const OPEN = new Set(["suggested", "chosen", "planned", "in_progress", "interrupted", "completed", "abandoned"]);
const LEVELS = support.training_levels.order;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function defaultVariablesFor(template: MissionTemplate, mode: AgeMode): Record<string, string | number> {
  // 0.5 أ.5: أمثلة القالب تُستخدم للتمارين المحايدة فقط؛ القوالب المرتبطة بالحياة لا تحمل مثالًا من عند النظام
  const ctx = template.life_binding === "none" && template.variable_defaults.context ? textByMode(template.variable_defaults.context, mode) : "";
  return { time_budget: template.variable_defaults.time_budget ?? defaultVariables.time_budget, context: ctx || defaultVariables.context[mode] };
}

/** ENGINE-3: نجاح سهل ×N → +1؛ تعثر ×N → −1، نسبة إلى آخر صعوبة لهذه القدرة. */
export function adaptiveDifficulty(templateDifficulty: number, capHistory: HistoryItem[]): number {
  const reflected = capHistory.filter((h) => h.status === "reflected" || h.status === "transferred");
  if (reflected.length === 0) return templateDifficulty;
  const last = reflected[0]!;
  const base = last.difficulty ?? templateDifficulty;
  const e = scoring.engine;
  const isEasy = (h: HistoryItem) => h.gate1 === e.easy_success.gate1 && h.gate2 === e.easy_success.gate2 && (h.hints_used ?? 0) <= e.easy_success.max_hints;
  const isStruggle = (h: HistoryItem) => (e.struggle.any_of.includes("abandoned") && h.gate1 === false) || (e.struggle.any_of.includes("gate2_not_yet") && h.gate2 === "not_yet");
  const up = reflected.slice(0, e.difficulty_up_after);
  const down = reflected.slice(0, e.difficulty_down_after);
  if (up.length === e.difficulty_up_after && up.every(isEasy)) return clamp(base + 1, 1, 5);
  if (down.length === e.difficulty_down_after && down.every(isStruggle)) return clamp(base - 1, 1, 5);
  return clamp(base, 1, 5);
}

export function selectSuggestions(input: SelectInput): Suggestion[] {
  if (input.breakMode) return [];
  const todays = input.history.filter((h) => h.suggested_for === input.today && !h.dismissed);
  const needed = Math.max(0, input.dailyCount - todays.length);
  if (needed === 0) return [];

  const stateOf = new Map(input.states.map((s) => [s.capability_id, s]));
  const openTemplateIds = new Set(input.history.filter((h) => (OPEN.has(h.status) && !h.dismissed) || (h.dismissed && h.suggested_for === input.today)).map((h) => h.template_id));
  const lookback = limits.engine.mechanic_diversity_lookback_days;
  const recent = input.history.filter((h) => daysBetween(input.today, h.suggested_for) <= lookback);
  const recentMechanics = new Set(recent.map((h) => h.mechanic));
  const countByCap = new Map<string, number>();
  for (const h of input.history) countByCap.set(h.primary_capability, (countByCap.get(h.primary_capability) ?? 0) + 1);
  const maxCount = Math.max(0, ...countByCap.values());
  const focus = new Set<string>(input.focusCapabilities);
  const dayIndex = Math.floor(Date.parse(input.today) / 86400000);

  // ENGINE-1: إن لم يوجد تركيز → أضعف قدرة بثقة كافية
  const minConf = game.incentive_stages.active_capability_min_confidence;
  const weakest = input.focusCapabilities.length ? null
    : input.states.filter((s) => !s.mastered && (s.confidence ?? 0) >= minConf).sort((a, b) => (a.score ?? 50) - (b.score ?? 50))[0]?.capability_id ?? null;

  // فحص إتقان مستحق (5.4): مهمة واحدة من مستوى independent_real في سياق جديد
  const dueChecks = input.states.filter((s) => s.mastered && s.next_mastery_check_at && s.next_mastery_check_at <= input.today && !input.history.some((h) => h.is_mastery_check && OPEN.has(h.status) && h.primary_capability === s.capability_id));

  // إحماء: مهمة واحدة أسبوعيًا من المستوى الأدنى (أ.6)
  const warmupUsed = recent.some((h) => { const st = stateOf.get(h.primary_capability); return st && LEVELS.indexOf(h.training_level) < LEVELS.indexOf(st.training_level); });
  const warmupAllowance = warmupUsed ? 0 : support.training_levels.warmup_lower_level_per_week;

  type Cand = { t: MissionTemplate; cap: string; score: number; why: string[]; mastery: boolean; warmup: boolean };
  const candidates: Cand[] = [];
  input.templates.forEach((t, i) => {
    if (t.status !== "active" || !t.age_modes.includes(input.ageMode) || openTemplateIds.has(t.id)) return;
    const cap = primaryCapability(t);
    const st = stateOf.get(cap);
    if (!st) return;
    const due = dueChecks.find((d) => d.capability_id === cap);
    if (st.mastered && !due) return;
    const mastery = Boolean(due) && t.training_level === support.mastery_check.on_fail.set_training_level;
    if (st.mastered && !mastery) return;
    const levelIdx = LEVELS.indexOf(t.training_level), curIdx = LEVELS.indexOf(st.training_level);
    const warmup = !st.mastered && levelIdx === curIdx - 1;
    if (!st.mastered && levelIdx !== curIdx && !warmup) return;
    if (warmup && warmupAllowance === 0) return;
    let score = 0;
    const why: string[] = [];
    if (mastery) { score += 10; why.push("فحص دوري للإتقان"); }
    if (focus.size && focus.has(cap)) { score += 3; why.push("قدرة مركّز عليها"); }
    if (weakest && cap === weakest) { score += 3; why.push("أضعف قدرة بثقة كافية"); }
    if (!recentMechanics.has(t.mechanic)) { score += 2; why.push("ميكانيكية لم تُجرَّب مؤخرًا"); }
    if (input.mechanicHint && t.mechanic === input.mechanicHint) { score += 3; why.push("اقتراح تكيّف: تجربة هذه الميكانيكية"); }
    const c = countByCap.get(cap) ?? 0;
    score += (maxCount - c) / (maxCount + 1);
    if (c === 0) why.push("قدرة لم تُدرَّب بعد");
    if (warmup) { score -= 1; why.push("إحماء من المستوى الأدنى"); }
    score += ((dayIndex + i) % Math.max(1, input.templates.length)) / (input.templates.length * 10);
    candidates.push({ t, cap, score, why, mastery, warmup });
  });
  candidates.sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));

  const picked: Suggestion[] = [];
  const usedMech = new Set<string>(), usedCap = new Set<string>();
  let warmupsLeft = warmupAllowance;
  const take = (c: Cand) => {
    if (c.warmup) { if (warmupsLeft === 0) return; warmupsLeft--; }
    const st = stateOf.get(c.cap)!;
    const capHistory = input.history.filter((h) => h.primary_capability === c.cap && !h.dismissed);
    picked.push({ template: c.t, difficulty: adaptiveDifficulty(c.t.difficulty, capHistory), support_level: st.support_level, variables: defaultVariablesFor(c.t, input.ageMode), rationale: c.why.join("، ") || "تنويع", is_mastery_check: c.mastery });
    usedMech.add(c.t.mechanic); usedCap.add(c.cap);
  };
  const notPicked = (c: Cand) => !picked.some((p) => p.template.id === c.t.id);
  for (const c of candidates) { if (picked.length >= needed) break; if (!usedMech.has(c.t.mechanic) && !usedCap.has(c.cap)) take(c); }
  for (const c of candidates) { if (picked.length >= needed) break; if (notPicked(c) && !usedMech.has(c.t.mechanic)) take(c); }
  for (const c of candidates) { if (picked.length >= needed) break; if (notPicked(c)) take(c); }
  return picked;
}
