/**
 * ذكاء المخطط (0.4 ب.10، ح.5، ط.7) — يتراجع مع التحسن. مستوى الدعم المعتمد هو مستوى قدرة التخطيط.
 * كل وظيفة: مخرج متحقق (Zod + قواعد الخادم) أو سلوك حتمي ثابت. لا يصل أي مخرج غير متحقق إلى قاعدة البيانات،
 * وكل اقتراح يمر بمعاينة/تأكيد المستخدم قبل الحفظ.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { planner, type AgeMode, type SupportLevel } from "@/shared/config";
import type { ModelCaller } from "@/modules/companion/model";
import { runFunction } from "@/modules/companion/runtime";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "@/modules/companion/prompts";
import { normalizeAr, type ParsedTask, type ParseContext } from "./nlp";
import { planDay, verifyPlacements, toMin, hhmm, type PlanTask, type Busy, type Placement, type DayPlanMode } from "./day-plan";
import { parseDayText, inventedTimes, type TextParse } from "@/modules/mirror/day-text";
import content from "@content/planner.ar.json";

type Db = SupabaseClient;
const aiCfg = planner.ai as unknown as {
  capability_for_support_level: string;
  task_breakdown: { L0_L1: { mode: "propose_draft"; max_steps: number }; L2_L3: { mode: "ask_first"; min_user_steps_before_suggest: number; max_suggested_steps: number } };
  day_planner: { L0_L1: { mode: DayPlanMode }; L2_L3: { mode: DayPlanMode; top_pick_range: [number, number] } };
};
const LEVELS: SupportLevel[] = ["L0_instruct", "L1_hint", "L2_ask", "L3_free"];
export const isLowSupport = (l: SupportLevel) => LEVELS.indexOf(l) <= 1;
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const sys = (mode: AgeMode, key: keyof typeof FUNCTION_INSTRUCTIONS) => `${personaSystem(mode)}\n\n${FUNCTION_INSTRUCTIONS[key]}`;

// ---------------------------------------------------------------- task_parser (احتياطي)
export const taskParserOutput = z.object({
  title: z.string().trim().min(1).max(200), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), due_time: hm.nullable(),
  priority: z.enum(["high", "medium", "low", "none"]).default("none"), tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  project: z.string().trim().max(80).nullable().default(null), estimate_min: z.number().int().positive().max(1440).nullable().default(null),
  reminder_offset_min: z.number().int().nonnegative().max(10080).nullable().default(null),
});
export type TaskParserOutput = z.infer<typeof taskParserOutput>;

/** ما فهمه المحلّل الحتمي يغلب (matched)؛ النموذج يملأ الناقص فقط. */
export function mergeParsed(det: ParsedTask, ai: TaskParserOutput): ParsedTask {
  const has = (k: string) => det.matched.includes(k);
  return {
    ...det,
    title: det.title && det.confidence >= 0.5 ? det.title : ai.title,
    due_date: has("date") ? det.due_date : ai.due_date,
    due_time: has("time") || det.due_time ? det.due_time : ai.due_time,
    priority: has("priority") ? det.priority : ai.priority,
    tags: det.tags.length ? det.tags : ai.tags,
    project: has("project") ? det.project : ai.project,
    estimate_min: has("estimate") ? det.estimate_min : ai.estimate_min,
    reminder: has("reminder") ? det.reminder : ai.reminder_offset_min === null ? null : { offset_min: ai.reminder_offset_min },
    matched: [...det.matched, "ai"],
  };
}

/** يُستدعى فقط حين ثقة المحلّل الحتمي < الحد (ب.4). عند تعذّر النموذج يبقى المخرج الحتمي كما هو. */
export async function taskParserFallback(i: { db: Db; caller: ModelCaller; profileId: string; mode: AgeMode; text: string; ctx: ParseContext; deterministic: ParsedTask }): Promise<{ parsed: ParsedTask; source: "ai" | "deterministic" }> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "task_parser", profileId: i.profileId, system: sys(i.mode, "task_parser"),
    dynamicSystem: `اليوم: ${i.ctx.today}. الساعة الغامضة حتى ${i.ctx.ambiguousPmUntil} مساءً.`,
    messages: [{ role: "user", content: i.text }], schema: taskParserOutput,
    verify: (o) => (o.due_date && o.due_date < i.ctx.today && !/امبارح|أمس|امس|yesterday/.test(normalizeAr(i.text)) ? "date_in_past" : null),
  });
  return r.ok ? { parsed: mergeParsed(i.deterministic, r.data), source: "ai" } : { parsed: i.deterministic, source: "deterministic" };
}

// ---------------------------------------------------------------- task_breakdown
export const taskBreakdownOutput = z.object({ steps: z.array(z.object({ title: z.string().trim().min(1).max(120), estimate_min: z.number().int().positive().max(600).nullable().default(null) })).max(10), note: z.string().max(300).nullable().default(null) });
export type BreakdownResult = { kind: "draft" | "ask_first" | "suggest"; steps: Array<{ title: string; estimate_min: number | null }>; question: string | null; source: "ai" | "fixed" };

export function verifyBreakdown(out: z.infer<typeof taskBreakdownOutput>, i: { mode: "propose_draft" | "suggest_missing"; userSteps: string[] }): string | null {
  const max = i.mode === "propose_draft" ? aiCfg.task_breakdown.L0_L1.max_steps : aiCfg.task_breakdown.L2_L3.max_suggested_steps;
  if (out.steps.length > max) return "too_many_steps";
  if (i.mode === "propose_draft" && out.steps.length === 0) return "no_steps";
  const mine = new Set(i.userSteps.map((s) => normalizeAr(s)));
  const seen = new Set<string>();
  for (const s of out.steps) { const k = normalizeAr(s.title); if (mine.has(k)) return "repeats_user_step"; if (seen.has(k)) return "duplicate_step"; seen.add(k); }
  return null;
}

/**
 * ب.10 / ب.15: عند L0–L1 مسودة حتى 5 خطوات. عند L2–L3 يسأل «شو أول خطوة؟» أولًا — لا يُرجع أي خطوة (ولا يستدعي النموذج)
 * قبل أن يكتب المستخدم خطوة على الأقل؛ بعدها حتى خطوتين ناقصتين كخيارات.
 */
export async function taskBreakdown(i: { db: Db; caller: ModelCaller; profileId: string; mode: AgeMode; level: SupportLevel; task: { title: string; notes: string | null }; userSteps: string[] }): Promise<BreakdownResult> {
  const userSteps = i.userSteps.map((s) => s.trim()).filter(Boolean);
  const low = isLowSupport(i.level);
  if (!low && userSteps.length < aiCfg.task_breakdown.L2_L3.min_user_steps_before_suggest) return { kind: "ask_first", steps: [], question: content.ai.breakdown.ask_first, source: "fixed" };
  const fnMode = low ? "propose_draft" as const : "suggest_missing" as const;
  const max = low ? aiCfg.task_breakdown.L0_L1.max_steps : aiCfg.task_breakdown.L2_L3.max_suggested_steps;
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "task_breakdown", profileId: i.profileId, system: sys(i.mode, "task_breakdown"),
    dynamicSystem: `mode=${fnMode}. max_steps=${max}.${userSteps.length ? ` خطوات المستخدم: ${userSteps.map((s, k) => `${k + 1}) ${s}`).join(" ")}` : ""}`,
    messages: [{ role: "user", content: `${i.task.title}${i.task.notes ? `\n${i.task.notes}` : ""}` }], schema: taskBreakdownOutput,
    verify: (o) => verifyBreakdown(o, { mode: fnMode, userSteps }),
  });
  const kind = low ? "draft" as const : "suggest" as const;
  return r.ok ? { kind, steps: r.data.steps, question: null, source: "ai" } : { kind, steps: [], question: low ? null : content.ai.breakdown.ask_first, source: "fixed" };
}

// ---------------------------------------------------------------- day_planner
export const dayPlannerOutput = z.object({ placements: z.array(z.object({ task_id: z.string().uuid(), start: hm })).max(30), note: z.string().max(300).nullable().default(null) });
export type DayPlanResult = { ok: true; mode: DayPlanMode; placements: Placement[]; source: "ai" | "deterministic" } | { ok: false; mode: DayPlanMode; error: "picks_required" };

export function dayPlanModeFor(level: SupportLevel): DayPlanMode { return isLowSupport(level) ? aiCfg.day_planner.L0_L1.mode : aiCfg.day_planner.L2_L3.mode; }

/** L0–L1 ترتيب كامل؛ L2–L3 يحتاج اختيار 1–3 أولًا ثم أماكنها فقط. احتياطي حتمي دائمًا. */
export async function dayPlanner(i: { db: Db; caller: ModelCaller; profileId: string; mode: AgeMode; level: SupportLevel; tasks: Array<PlanTask & { title: string }>; picks?: string[]; today: string; nowMin: number; busy: Busy[] }): Promise<DayPlanResult> {
  const mode = dayPlanModeFor(i.level);
  const det = planDay({ mode, tasks: i.tasks, picks: i.picks, today: i.today, nowMin: i.nowMin, busy: i.busy });
  if (!det.ok) return { ok: false, mode, error: det.error };
  const allowed = mode === "user_picks_top_then_place" ? [...new Set(i.picks ?? [])] : i.tasks.map((t) => t.id);
  const list = i.tasks.filter((t) => allowed.includes(t.id)).map((t) => `${t.id} | ${t.title} | ${t.priority} | ${t.due_date ?? "-"} ${t.due_time?.slice(0, 5) ?? ""} | ${t.estimate_min ?? "-"}د`).join("\n");
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "day_planner", profileId: i.profileId, system: sys(i.mode, "day_planner"),
    dynamicSystem: `mode=${mode === "user_picks_top_then_place" ? "place_picks" : "full_order"}. الآن ${hhmm(i.nowMin)}. اليوم ${i.today}. المشغول: ${i.busy.map((b) => `${hhmm(b.start)}-${hhmm(b.end)}`).join("، ") || "لا شيء"}.`,
    messages: [{ role: "user", content: list || "-" }], schema: dayPlannerOutput,
    verify: (o) => { if (mode === "user_picks_top_then_place" && o.placements.length !== allowed.length) return "must_place_all_picks"; return verifyPlacements(o.placements, { allowed, nowMin: i.nowMin, busy: i.busy, tasks: i.tasks }); },
  });
  if (!r.ok) return { ok: true, mode, placements: det.placements, source: "deterministic" };
  const est = (id: string) => i.tasks.find((t) => t.id === id)?.estimate_min ?? planDayDefaultEstimate();
  return { ok: true, mode, source: "ai", placements: r.data.placements.map((p) => ({ task_id: p.task_id, start: p.start, end: hhmm(toMin(p.start) + est(p.task_id)) })).sort((a, b) => toMin(a.start) - toMin(b.start)) };
}
const planDayDefaultEstimate = () => (planner.ai as unknown as { day_planner: { defaults: { default_estimate_min: number } } }).day_planner.defaults.default_estimate_min;

// ---------------------------------------------------------------- weekly_review (صياغة فقط)
export const weeklyReviewOutput = z.object({ intro: z.string().trim().min(1).max(400), increment_line: z.string().trim().max(300).nullable().default(null) });
const OTHERS = /(غيرك|الآخرين|الاخرين|اصحابك|أصحابك|زملائك|زملاءك|رفقاتك|باقي الناس|أقرانك|اقرانك)/;
const BLAME = /(فشل|كسول|قصّرت|قصرت|ضيّعت|ضيعت)/;

/** «صياغة فقط»: لا رقم ليس في المعطيات، لا مقارنة بالآخرين، لا لوم. */
export function verifyReviewWording(o: z.infer<typeof weeklyReviewOutput>, factsText: string): string | null {
  const text = `${o.intro} ${o.increment_line ?? ""}`;
  if (OTHERS.test(text)) return "comparison_with_others";
  if (BLAME.test(text)) return "blame";
  const allowedNums = new Set((normalizeAr(factsText).match(/\d+(\.\d+)?/g) ?? []));
  for (const n of normalizeAr(text).match(/\d+(\.\d+)?/g) ?? []) if (!allowedNums.has(n)) return "invented_number";
  return null;
}

export async function weeklyReviewWording(i: { db: Db; caller: ModelCaller; profileId: string; mode: AgeMode; facts: string; fallback: { intro: string; incrementLine: string | null } }): Promise<{ intro: string; incrementLine: string | null; source: "ai" | "fixed" }> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "weekly_review", profileId: i.profileId, system: sys(i.mode, "weekly_review"),
    messages: [{ role: "user", content: i.facts }], schema: weeklyReviewOutput, verify: (o) => verifyReviewWording(o, `${i.facts} ${i.fallback.intro} ${i.fallback.incrementLine ?? ""}`),
  });
  return r.ok ? { intro: r.data.intro, incrementLine: r.data.increment_line ?? i.fallback.incrementLine, source: "ai" } : { ...i.fallback, source: "fixed" };
}

// ---------------------------------------------------------------- day_reconstructor
export const dayReconstructorOutput = z.object({
  blocks: z.array(z.object({ start: hm, end: hm, category: z.string().min(1).max(40), label: z.string().max(60).nullable().default(null), confidence: z.number().min(0).max(1) })).max(40),
  gaps: z.array(z.object({ start: hm, end: hm })).max(40).default([]),
});

export function verifyReconstruction(o: z.infer<typeof dayReconstructorOutput>, i: { text: string; categories: string[]; knownBoundaries: string[] }): string | null {
  for (const b of o.blocks) { if (!i.categories.includes(b.category)) return "unknown_category"; if (toMin(b.end) <= toMin(b.start)) return "bad_range"; }
  const bad = inventedTimes(o.blocks, i.text, i.knownBoundaries);
  return bad.length ? `invented_times:${bad.join(",")}` : null;
}

/** ط.3/ط.7: نص حر ⇒ مقاطع للمعاينة الإلزامية (لا حفظ هنا). احتياطي حتمي عند تعذّر النموذج أو رفض مخرجه. */
export async function dayReconstructor(i: { db: Db; caller: ModelCaller; profileId: string; mode: AgeMode; text: string; categories: string[]; knownBoundaries: string[]; nowHHMM: string | null }): Promise<TextParse & { source: "ai" | "deterministic" }> {
  const r = await runFunction({
    db: i.db, caller: i.caller, fn: "day_reconstructor", profileId: i.profileId, system: sys(i.mode, "day_reconstructor"),
    dynamicSystem: `الفئات: ${i.categories.join(", ")}. حدود معروفة: ${i.knownBoundaries.join(", ") || "-"}. الآن: ${i.nowHHMM ?? "-"}.`,
    messages: [{ role: "user", content: i.text }], schema: dayReconstructorOutput,
    verify: (o) => verifyReconstruction(o, { text: i.text, categories: i.categories, knownBoundaries: i.knownBoundaries }),
  });
  if (r.ok) return { blocks: r.data.blocks.map((b) => ({ ...b, label: b.label ?? null })), gaps: r.data.gaps, unplaced: [], source: "ai" };
  return { ...parseDayText(i.text, i.categories, i.nowHHMM), source: "deterministic" };
}
