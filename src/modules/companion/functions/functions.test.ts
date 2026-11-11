/** اختبارات ثابتة لكل وظيفة (7.2) وقواعد AI-15 وأ.1 — بمستدعٍ وهمي. */
import { describe, it, expect } from "vitest";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { fakeCaller } from "../runtime";
import { goalBuilderTurn, verifyGoalOutput, fixedGoalTurn } from "./goal-builder";
import { reflectionCoachTurn, verifyReflectionOutput } from "./reflection-coach";
import { selectWithAi, applySelectorRules } from "./mission-selector";
import { classifyTask } from "./task-classifier";
import { narrate, normalizeStrategy, weeklySummary } from "./narrator-summary-normalizer";
import { loadTemplatesFromContent } from "@/modules/library/content";
import { selectSuggestions } from "@/modules/engine/select";
import { CAPABILITY_IDS, ai } from "@/shared/config";
import type { GoalBuilderOutput } from "../schemas";

const templates = loadTemplatesFromContent();
const safe = { flag: false, category: null, severity: null };
const goalOut = (over: Partial<GoalBuilderOutput> = {}): GoalBuilderOutput => ({ next_question: "ولماذا هذا؟", reflection_of_user_words: "أريد أن أنهي واجباتي", thinking_move_named: null, phase: "climb_why", draft: { goals: [{ temp_id: "g1", parent_temp_id: null, title_user_words: "أنهي واجباتي قبل العشاء", why_user_words: null }], first_step_user_words: null }, needs_user_confirmation: false, safety: safe, ...over });

describe("goal_builder — AI-15 وأ.1", () => {
  it("طلب «اعمل لي خطة» لا يُرجع خطة: المخرج بلا سؤال يُرفض ويسقط إلى سؤال ثابت", async () => {
    const db = new FakeDb();
    const plan = JSON.stringify(goalOut({ next_question: null, phase: "descend_how", draft: { goals: [{ temp_id: "g1", parent_temp_id: null, title_user_words: "خطة", why_user_words: null }], first_step_user_words: "الخطوة 1: افتح الكتاب. الخطوة 2: ..." } }));
    const caller = fakeCaller([plan, plan]);
    const r = await goalBuilderTurn({ db: db.client(), caller, profileId: "p", mode: "teen", history: [], userMessage: "اعمل لي خطة", draft: null, turn: 1 });
    expect(r.source).toBe("fixed");
    expect(r.output.next_question).toBeTruthy();
    expect(r.output.draft.first_step_user_words).toBeNull();
    expect(db.rows("ai_calls").every((c) => c.valid === false)).toBe(true);
  });
  it("كل رد فيه سؤال واحد كحد أقصى", () => {
    expect(verifyGoalOutput(goalOut({ next_question: "لماذا؟ ومتى؟" }), "x")).toBe("more_than_one_question");
    expect(verifyGoalOutput(goalOut(), "x")).toBeNull();
  });
  it("الخطوة الأولى بكلمات المستخدم عند طلب الخطة، ومنع الدورات والعمق", () => {
    expect(verifyGoalOutput(goalOut({ draft: { goals: [], first_step_user_words: "أبدأ بالرياضيات" } }), "اعمل لي خطة: أبدأ بالرياضيات")).toBeNull();
    expect(verifyGoalOutput(goalOut({ draft: { goals: [], first_step_user_words: "افتح الكتاب" } }), "اعمل لي خطة")).toBe("plan_written_by_model");
    expect(verifyGoalOutput(goalOut({ draft: { goals: [{ temp_id: "a", parent_temp_id: "b", title_user_words: "a", why_user_words: null }, { temp_id: "b", parent_temp_id: "a", title_user_words: "b", why_user_words: null }], first_step_user_words: null } }), "x")).toBe("cycle");
    expect(verifyGoalOutput(goalOut({ draft: { goals: [{ temp_id: "a", parent_temp_id: "zz", title_user_words: "a", why_user_words: null }], first_step_user_words: null } }), "x")).toBe("dangling_parent");
  });
  it("مخرج صالح يُقبل كما هو والمسودة بكلمات المستخدم", async () => {
    const db = new FakeDb();
    const r = await goalBuilderTurn({ db: db.client(), caller: fakeCaller([JSON.stringify(goalOut())]), profileId: "p", mode: "teen", history: [], userMessage: "أريد أن أنهي واجباتي قبل العشاء", draft: null, turn: 1 });
    expect(r.source).toBe("ai");
    expect(r.output.draft.goals[0]!.title_user_words).toBe("أنهي واجباتي قبل العشاء");
  });
  it("السقوط الثابت يبني سلسلة من كلمات المستخدم: ما الشيء؟ → لماذا؟ → الخطوة الأولى → تأكيد", () => {
    const t0 = fixedGoalTurn("adult", 0, null, "");
    expect(t0.next_question).toContain("قادرًا");
    const t1 = fixedGoalTurn("adult", 1, t0.draft, "أستيقظ مبكرًا كل يوم");
    expect(t1.draft.goals[0]!.title_user_words).toBe("أستيقظ مبكرًا كل يوم");
    const t2 = fixedGoalTurn("adult", 2, t1.draft, "لأنجز عملي قبل الظهر");
    expect(t2.draft.goals[0]!.why_user_words).toBe("لأنجز عملي قبل الظهر");
    const t3 = fixedGoalTurn("adult", 3, t2.draft, "أضبط المنبه الليلة");
    expect(t3.needs_user_confirmation).toBe(true);
    expect(t3.draft.first_step_user_words).toBe("أضبط المنبه الليلة");
    expect(t3.next_question).toBeNull();
  });
});

describe("reflection_coach — أ.1", () => {
  const rd = templates.find((t) => t.id === "rd-sim-01")!;
  const out = (o: Record<string, unknown> = {}) => JSON.stringify({ next_question: "ما الذي ساعدك؟", done: false, reflection_summary_user_words: null, thinking_move_named: null, custom_strategy_fit: null, evidence_candidates: [], safety: safe, ...o });
  it("المرشحون لقدرات القالب + self_awareness + thinking فقط؛ fit بلا استراتيجية مخصصة مرفوض", () => {
    const base = JSON.parse(out());
    expect(verifyReflectionOutput({ ...base, evidence_candidates: [{ capability_id: "planning", type: "reflection_quality", value: 0.5, rationale: "x" }] }, rd, null, 1)).toContain("not_allowed");
    expect(verifyReflectionOutput({ ...base, evidence_candidates: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.5, rationale: "x" }] }, rd, null, 1)).toBeNull();
    expect(verifyReflectionOutput({ ...base, custom_strategy_fit: 0.2 }, rd, null, 1)).toBe("fit_without_custom_strategy");
    expect(verifyReflectionOutput({ ...base, custom_strategy_fit: 0.2 }, rd, "طريقتي", 1)).toBeNull();
  });
  it("حد أقصى 4 أدوار ثم done إجباريًا، والقيم تُقص إلى [−1, 1]", async () => {
    const db = new FakeDb();
    const notDone = out({ done: false });
    const r = await reflectionCoachTurn({ db: db.client(), caller: fakeCaller([notDone, notDone]), profileId: "p", mode: "teen", support: "L1_hint", template: rd, missionFacts: {}, history: [], userMessage: "x", turn: ai.validation.reflection_max_turns, customStrategy: null, fixedPrompts: ["س1", "س2"] });
    expect(r.source).toBe("fixed");
    expect(r.output.done).toBe(true);
    const ok = await reflectionCoachTurn({ db: db.client(), caller: fakeCaller([out({ done: true, next_question: null, reflection_summary_user_words: "تعلمت", evidence_candidates: [{ capability_id: "attention", type: "reflection_quality", value: 0.6, rationale: "r" }] })]), profileId: "p", mode: "teen", support: "L1_hint", template: rd, missionFacts: {}, history: [], userMessage: "x", turn: 2, customStrategy: null, fixedPrompts: [] });
    expect(ok.source).toBe("ai");
    expect(ok.output.evidence_candidates[0]!.value).toBe(0.6);
  });
});

describe("mission_selector — 7.3", () => {
  const candidates = selectSuggestions({ ageMode: "teen", today: "2026-11-05", templates, history: [], states: CAPABILITY_IDS.map((c) => ({ capability_id: c, training_level: "simulated" as const, support_level: "L1_hint" as const, mastered: false, next_mastery_check_at: null })), focusCapabilities: [], dailyCount: 3, breakMode: false });
  it("template_id خارج المرشحين → سقوط إلى أعلى مرشح بالقواعد", async () => {
    const db = new FakeDb();
    const bad = JSON.stringify({ template_id: "zz-sim-99", variables: {}, difficulty: 2, rationale: "x" });
    const r = await selectWithAi({ db: db.client(), caller: fakeCaller([bad, bad]), profileId: "p", mode: "teen", candidates, sources: [], goalTitle: null });
    expect(r.source).toBe("rules");
    expect(r.suggestion.template.id).toBe(candidates[0]!.template.id);
  });
  it("الصعوبة والوقت يُقصان ضمن حدود القالب، والنموذج لا يكتب السياق (0.5 أ.5)", () => {
    const c = candidates[0]!;
    const s = applySelectorRules({ template_id: c.template.id, variables: { time_budget: 999, context: " القراءة " } as never, difficulty: 5, rationale: "r" }, candidates)!;
    expect(s.difficulty).toBeLessThanOrEqual(c.difficulty + 1);
    expect(s.variables.time_budget).toBe(c.template.max_duration);
    expect(s.variables.context).toBe(c.variables.context); // سياق القواعد كما هو، لا نص النموذج
    expect(s.life_source).toBeUndefined();
  });
});

describe("task_classifier / progress_narrator / weekly_summary / strategy_normalizer", () => {
  it("المصنّف: أوزان لا تجمع إلى 1 أو قدرة أساسية خاطئة → null (اختيار يدوي)", async () => {
    const db = new FakeDb();
    const bad = JSON.stringify({ mechanic: "decompose", capability_weights: { attention: 0.9, planning: 0.1 }, suggested_goal_id: null, reflection_prompts: ["س"] });
    expect(await classifyTask({ db: db.client(), caller: fakeCaller([bad, bad]), profileId: "p", mode: "adult", text: "أرتب مكتبي", goals: [] })).toBeNull();
    const good = JSON.stringify({ mechanic: "decompose", capability_weights: { planning: 0.7, thinking: 0.3 }, suggested_goal_id: null, reflection_prompts: ["س"] });
    expect((await classifyTask({ db: db.client(), caller: fakeCaller([good]), profileId: "p", mode: "adult", text: "أرتب مكتبي", goals: [] }))?.mechanic).toBe("decompose");
  });
  it("السرد: لغة نقاط مرفوضة → الجمل الثابتة؛ وإلا سرد النموذج", async () => {
    const db = new FakeDb();
    const pts = JSON.stringify({ narrative: "حصلت على 40 XP!", highlighted_capability: null });
    const r = await narrate({ db: db.client(), caller: fakeCaller([pts, pts]), profileId: "p", mode: "teen", facts: {}, fixedLines: ["أنهيت المهمة."] });
    expect(r).toMatchObject({ source: "fixed", lines: ["أنهيت المهمة."] });
    const ok = await narrate({ db: db.client(), caller: fakeCaller([JSON.stringify({ narrative: "عندما ظهر المشتت تجاهلته.", highlighted_capability: "attention" })]), profileId: "p", mode: "teen", facts: {}, fixedLines: [] });
    expect(ok.highlighted).toBe("attention");
  });
  it("الملخص الأسبوعي يرفض لغة التشخيص؛ التسمية ≤ 4 كلمات وإلا custom", async () => {
    const db = new FakeDb();
    const diag = JSON.stringify({ improved: [], needs_support: ["يبدو عليه اضطراب انتباه"], guardian_tip: "x" });
    expect((await weeklySummary({ db: db.client(), caller: fakeCaller([diag, diag]), profileId: "p", mode: "child", stats: {} })).source).toBe("fixed");
    expect(await normalizeStrategy({ db: db.client(), caller: fakeCaller([JSON.stringify({ label: "تقسيم ثم بداية سريعة" })]), profileId: "p", mode: "adult", mechanic: "decompose", strategy: "..." })).toBe("تقسيم ثم بداية سريعة");
    expect(await normalizeStrategy({ db: db.client(), caller: fakeCaller(['{"label":"كلمة واحدة اثنتان ثلاث أربع خمس"}', '{"label":"كلمة واحدة اثنتان ثلاث أربع خمس"}']), profileId: "p", mode: "adult", mechanic: "decompose", strategy: "..." })).toBe("custom");
  });
});
