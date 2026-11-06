/** اختبارات قبول 0.4 (الجزء أ): أشكال الرد الذكية للمرافق. السياسة يفرضها الخادم لا النموذج. */
import { describe, it, expect } from "vitest";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { ai, customization, type Moment } from "@/shared/config";
import { fakeCaller } from "../runtime";
import { goalBuilderTurn } from "../functions/goal-builder";
import { reflectionCoachTurn, softFollowUpTurn, type ReflectionTurnInput } from "../functions/reflection-coach";
import { loadTemplatesFromContent } from "@/modules/library/content";
import { applyBudget, buildOptions, enforceShape, fixedOptionsFor, freeTextBudget, isStuckHesitation, isStuckText, momentSupport, needsSoftFollowUp, policyMode, resolveAnswerSafe, validateOptions } from "./index";
import messagesContent from "@content/companion_messages.ar.json";

const rm = ai.response_modes;
const templates = loadTemplatesFromContent();
const rd = templates.find((t) => t.id === "rd-sim-01")!;
const safe = { flag: false, category: null, severity: null };
const budget = { used: 0, budget: rm.free_text_budget.per_session };
const sh = (moment: Moment, over: Partial<Parameters<typeof enforceShape>[0]> = {}) =>
  enforceShape({ moment, support: "L1_hint", ageMode: "teen", afterStuck: false, session: budget, model: {}, ...over });

describe("أ.9-1 goal_why: كتابة دائمًا ولا خيارات أبدًا", () => {
  it("حتى لو أرجع النموذج خيارات، وحتى بعد «لا أعرف»، وحتى مع ميزانية منتهية", async () => {
    const modelOut = JSON.stringify({
      next_question: "ولماذا هذا؟", reflection_of_user_words: "x", thinking_move_named: null, phase: "climb_why",
      draft: { goals: [{ temp_id: "g1", parent_temp_id: null, title_user_words: "أنهي واجباتي", why_user_words: null }], first_step_user_words: null },
      needs_user_confirmation: false, safety: safe, moment: "goal_why", response_mode: "choices_plus_other",
      options: [{ label: "لأنني أريد", source: "ai" }, { label: "لأن الوقت ضيق", source: "ai" }],
    });
    for (const userMessage of ["أنهي واجباتي", "لا أعرف"]) {
      const r = await goalBuilderTurn({ db: new FakeDb().client(), caller: fakeCaller([modelOut]), profileId: "p", mode: "teen", history: [], userMessage, draft: null, turn: 1, support: "L0_instruct", session: { used: 99, budget: 1 } });
      expect(r.source).toBe("ai");
      expect(r.output.moment).toBe("goal_why");
      expect(r.output.response_mode).toBe("free_text");
      expect(r.output.options).toEqual([]);
      expect(r.shape.consumesBudget).toBe(false); // goal_why معفاة من الميزانية
    }
  });
});

describe("أ.9-2 strategy_choice عند L2", () => {
  it("أول رد free_text بلا خيارات؛ بعد «لا أعرف» يصبح choices_plus_other بثلاثة خيارات", () => {
    const first = sh("strategy_choice", { support: "L2_ask", ageMode: "adult" });
    expect(first.response_mode).toBe("free_text");
    expect(first.options).toEqual([]);
    expect(isStuckText("لا أعرف")).toBe(true);
    const stuck = sh("strategy_choice", { support: "L2_ask", ageMode: "adult", afterStuck: true, model: { options: [{ label: "أجهّز كل شيء أولًا", source: "template" }, { label: "أبدأ بأصغر خطوة", source: "ai" }, { label: "أقسم العمل", source: "ai" }] } });
    expect(stuck.response_mode).toBe("choices_plus_other");
    expect(stuck.options).toHaveLength(3);
  });
  it("عند L0–L1 تُعرض الخيارات من البداية", () => {
    expect(policyMode({ moment: "strategy_choice", support: "L1_hint", ageMode: "teen", afterStuck: false })).toBe("choices_plus_other");
  });
  it("stuck يُطلق أيضًا بالتردد فوق 45 ثانية ويقبل صيغ العامية والإنجليزية", () => {
    expect(isStuckHesitation(46)).toBe(true);
    expect(isStuckHesitation(45)).toBe(false);
    for (const t of ["ما بعرف شو أكتب", "مش عارف", "I don't know", "لا اعرف"]) expect(isStuckText(t)).toBe(true);
    expect(isStuckText("أريد أن أتعلم البرمجة")).toBe(false);
  });
});

describe("أ.9-3 ميزانية الكتابة", () => {
  it("اللحظة الثالثة من نوع reflection_core تتحول إلى choices_plus_other", () => {
    const a = sh("reflection_core", { session: { used: 0, budget: 2 } });
    const b = sh("reflection_core", { session: { used: 1, budget: 2 } });
    const c = sh("reflection_core", { session: { used: 2, budget: 2 } });
    expect([a.response_mode, b.response_mode, c.response_mode]).toEqual(["free_text", "free_text", "choices_plus_other"]);
    expect(c.options.length).toBeGreaterThanOrEqual(rm.options.min);
    expect(c.replaced?.reasons).toContain("free_text_budget_exhausted");
    expect(a.consumesBudget).toBe(true);
    expect(c.consumesBudget).toBe(false);
  });
  it("goal_why معفاة من الميزانية دائمًا", () => {
    expect(applyBudget("free_text", "goal_why", 50, 2)).toBe("free_text");
  });
});

describe("أ.9-4 الميزانية تنخفض إلى 1", () => {
  it("بعد 22:00 وقبل 05:00، وجلسة العودة، وإعداد companion_prefer_choices", () => {
    const base = { localTime: "15:00", comebackSession: false, preferChoices: false };
    expect(freeTextBudget(base)).toBe(rm.free_text_budget.per_session);
    expect(freeTextBudget({ ...base, localTime: "22:30" })).toBe(rm.free_text_budget.reduced);
    expect(freeTextBudget({ ...base, localTime: "04:59" })).toBe(rm.free_text_budget.reduced);
    expect(freeTextBudget({ ...base, localTime: "05:00" })).toBe(rm.free_text_budget.per_session);
    expect(freeTextBudget({ ...base, comebackSession: true })).toBe(rm.free_text_budget.reduced);
    expect(freeTextBudget({ ...base, preferChoices: true })).toBe(rm.free_text_budget.reduced);
    expect(rm.free_text_budget.reduced).toBe(1);
  });
  it("الإعداد موجود في الكتالوج بافتراضي false وقابل لتعديل الطفل", () => {
    const e = customization.catalog.companion_prefer_choices!;
    expect(e.type).toBe("bool");
    expect(e.default).toEqual({ child: false, teen: false, adult: false });
    expect(customization.player_editable_in_child).toContain("companion_prefer_choices");
  });
});

describe("أ.9-5 إجابة بخيار لا تولّد reflection_quality", () => {
  const out = (o: Record<string, unknown> = {}) => JSON.stringify({ next_question: "ما الذي ساعدك؟", done: false, reflection_summary_user_words: null, thinking_move_named: null, custom_strategy_fit: null, evidence_candidates: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.7, rationale: "r" }], safety: safe, ...o });
  const base = (over: Partial<ReflectionTurnInput>): ReflectionTurnInput => ({ db: new FakeDb().client(), caller: fakeCaller([out()]), profileId: "p", mode: "teen", support: "L1_hint", template: rd, missionFacts: {}, history: [], userMessage: "تشتت", turn: 1, customStrategy: null, fixedPrompts: ["س"], ...over });
  it("خيار ⇒ بلا مرشحين (ولا قيمة سلبية)، كتابة أو صوت ⇒ المرشح يُقبل", async () => {
    const viaOption = await reflectionCoachTurn(base({ inputMethod: "option" }));
    expect(viaOption.output.evidence_candidates).toEqual([]);
    const typed = await reflectionCoachTurn(base({ caller: fakeCaller([out()]), inputMethod: "typed" }));
    expect(typed.output.evidence_candidates).toHaveLength(1);
    const voice = await reflectionCoachTurn(base({ caller: fakeCaller([out()]), inputMethod: "voice" }));
    expect(voice.output.evidence_candidates).toHaveLength(1);
    expect(rm.evidence.choice_answers_negative).toBe(false);
  });
});

describe("أ.9-6 تحقق الخيارات", () => {
  it("خيار أطول من 40 حرفًا يُرفض ويُستبدل بخيارات ثابتة", () => {
    const long = "ا".repeat(rm.options.max_chars + 1);
    expect(validateOptions([{ label: long }, { label: "قصير" }], 4)).toBe("option_too_long");
    const r = buildOptions({ moment: "reflection_secondary", max: 4, model: [{ label: long, source: "ai" }, { label: "قصير", source: "ai" }], userWords: [], template: [] });
    expect(r.usedFixed).toBe(true);
    expect(r.reason).toBe("option_too_long");
    expect(r.options.every((o) => [...o.label].length <= rm.options.max_chars)).toBe(true);
    expect(r.options.length).toBeGreaterThanOrEqual(rm.options.min);
  });
  it("تكرار، قلة أو كثرة، وخطة كاملة كلها مرفوضة", () => {
    expect(validateOptions([{ label: "نعم" }, { label: " نعم " }], 4)).toBe("duplicate_option");
    expect(validateOptions([{ label: "واحد" }], 4)).toBe("too_few_options");
    expect(validateOptions(Array.from({ length: 5 }, (_, i) => ({ label: `خ${i}` })), 4)).toBe("too_many_options");
    expect(validateOptions([{ label: "افتح الكتاب. ثم حل التمرين." }, { label: "ب" }], 4)).toBe("option_is_full_plan");
    expect(validateOptions([{ label: "1. افتح الكتاب" }, { label: "ب" }], 4)).toBe("option_is_full_plan");
  });
  it("كلمات المستخدم أولًا: إن وُجدت يُدرج خيار منها، ومصدر الخيار يُرقّى إن طابقها", () => {
    const r = buildOptions({ moment: "goal_what", max: 3, model: [{ label: "تعلم شيء", source: "ai" }, { label: "إنجاز شيء", source: "ai" }, { label: "بناء عادة", source: "ai" }], userWords: ["أنهي واجباتي"], template: [] });
    expect(r.usedFixed).toBe(false);
    expect(r.options.some((o) => o.source === "user_words" && o.label === "أنهي واجباتي")).toBe(true);
    expect(r.options[0]!.source).toBe("user_words");
    expect(r.options).toHaveLength(3);
    const promoted = buildOptions({ moment: "goal_what", max: 4, model: [{ label: "أنهي واجباتي", source: "ai" }, { label: "ب", source: "ai" }], userWords: ["أنهي واجباتي"], template: [] });
    expect(promoted.options.find((o) => o.label === "أنهي واجباتي")!.source).toBe("user_words");
  });
  it("الخيارات الثابتة لكل لحظة ضمن الحدود", () => {
    for (const m of ["confirm", "logistics", "feeling_check", "strategy_choice", "goal_what", "reflection_secondary", "obstacle_naming", "priority_pick", "stuck"] as Moment[]) {
      const o = fixedOptionsFor(m, 4);
      expect(validateOptions(o, 4), m).toBeNull();
    }
    expect(fixedOptionsFor("stuck", rm.policy.stuck.max_options!).length).toBeLessThanOrEqual(3);
  });
});

describe("أ.9-7 الحد الأدنى اللطيف للكتابة", () => {
  const input = (over: Partial<ReflectionTurnInput>): ReflectionTurnInput => ({ db: new FakeDb().client(), caller: fakeCaller([]), profileId: "p", mode: "adult", support: "L2_ask", template: rd, missionFacts: {}, history: [], userMessage: "تعبت جدًا", turn: 1, customStrategy: null, fixedPrompts: [], answeredMoment: "reflection_core", ...over });
  it("adult كتب كلمتين في reflection_core: سؤال متابعة واحد فقط ثم القبول", () => {
    const first = softFollowUpTurn(input({}));
    expect(first).not.toBeNull();
    expect(first!.output.next_question).toBe(messagesContent.soft_min_followup);
    expect(first!.shape.consumesBudget).toBe(false);
    expect(softFollowUpTurn(input({ followUpAsked: true }))).toBeNull(); // يقبل أي رد بعدها
  });
  it("الحدود: child أي نص، teen ≥ 3 كلمات، adult ≥ 5 كلمات، والخيار لا يُسأل عنه", () => {
    const f = (ageMode: "child" | "teen" | "adult", text: string, moment: Moment = "reflection_core") => needsSoftFollowUp({ moment, ageMode, text, alreadyAsked: false });
    expect(f("child", "تعبت")).toBe(false);
    expect(f("teen", "تعبت جدًا")).toBe(true);
    expect(f("teen", "تعبت جدًا اليوم")).toBe(false);
    expect(f("adult", "تعبت جدًا اليوم فعلًا")).toBe(true);
    expect(f("adult", "تعبت جدًا اليوم فعلًا وأردت التوقف")).toBe(false);
    expect(f("adult", "كلمتان فقط", "reflection_secondary")).toBe(false);
    expect(f("adult", "عائق", "obstacle_naming")).toBe(true);
    expect(needsSoftFollowUp({ moment: "reflection_core", ageMode: "adult", text: "خيار", alreadyAsked: false, inputMethod: "option" })).toBe(false);
  });
  it("reflectionCoachTurn يرجع سؤال المتابعة بلا استدعاء النموذج", async () => {
    const caller = fakeCaller([]);
    const r = await reflectionCoachTurn(input({ caller }));
    expect(caller.calls).toHaveLength(0);
    expect(r.softFollowUp).toBe(true);
    expect(r.output.done).toBe(false);
  });
});

describe("سياسة الأشكال الكاملة (أ.3)", () => {
  const modes = (moment: Moment, support: "L1_hint" | "L2_ask", ageMode: "child" | "teen" | "adult" = "teen") => policyMode({ moment, support, ageMode, afterStuck: false });
  it("الجدول حرفيًا", () => {
    for (const m of ["confirm", "logistics", "feeling_check"] as Moment[]) { expect(modes(m, "L1_hint")).toBe("quick_replies"); expect(modes(m, "L2_ask")).toBe("quick_replies"); }
    expect(modes("goal_what", "L1_hint")).toBe("free_text");
    expect(modes("reflection_core", "L2_ask")).toBe("free_text");
    expect(modes("reflection_secondary", "L1_hint")).toBe("choices_plus_other");
    expect(modes("reflection_secondary", "L2_ask")).toBe("choices_plus_other");
    expect(modes("obstacle_naming", "L2_ask", "child")).toBe("choices_plus_other");
    expect(modes("obstacle_naming", "L2_ask", "teen")).toBe("free_text");
    expect(modes("priority_pick", "L1_hint")).toBe("quick_replies");
    expect(modes("priority_pick", "L2_ask")).toBe("choices_plus_other");
    expect(modes("stuck", "L2_ask")).toBe("choices_plus_other");
    expect(modes("free_chat", "L1_hint")).toBe("free_text");
  });
  it("goal_what بعد stuck: خيارات من كلمات المستخدم السابقة", () => {
    const s = sh("goal_what", { afterStuck: true, userWords: ["أنهي واجباتي", "أرتب غرفتي"], model: { options: [{ label: "تعلم شيء", source: "ai" }, { label: "عادة جديدة", source: "ai" }, { label: "إنجاز شيء", source: "ai" }] } });
    expect(s.response_mode).toBe("choices_plus_other");
    expect(s.options.some((o) => o.source === "user_words")).toBe(true);
    expect(s.options.length).toBeLessThanOrEqual(rm.policy.stuck.max_options!);
  });
  it("الخادم يستبدل شكل النموذج المخالف ويسجّل ذلك", () => {
    const s = sh("reflection_core", { model: { response_mode: "quick_replies", options: [{ label: "نعم" }, { label: "لا" }] } });
    expect(s.response_mode).toBe("free_text");
    expect(s.options).toEqual([]);
    expect(s.replaced).toMatchObject({ model_mode: "quick_replies", final_mode: "free_text" });
    expect(s.replaced!.reasons).toContain("model_mode_overridden");
  });
  it("مستوى الدعم للحظة: قدرة اللحظة أولًا ثم متوسط المستويات", () => {
    expect(momentSupport("strategy_choice", { planning: "L3_free", self_awareness: "L0_instruct" }, [])).toBe("L3_free");
    expect(momentSupport("confirm", {}, ["L0_instruct", "L3_free"])).toBe("L1_hint");
    expect(momentSupport("confirm", {}, [])).toBe("L0_instruct");
  });
  it("resolveAnswer يقبل خيارًا موجودًا فقط", () => {
    const opts = [{ id: "o1", label: "تشتت", source: "ai" as const }];
    expect(resolveAnswerSafe({ text: "", optionId: "o1", method: "option" }, opts)).toEqual({ ok: true, text: "تشتت", method: "option", optionId: "o1" });
    expect(resolveAnswerSafe({ text: "", optionId: "zz", method: "option" }, opts)).toEqual({ ok: false });
    expect(resolveAnswerSafe({ text: "كتبت", optionId: null, method: "voice" }, opts)).toMatchObject({ ok: true, method: "voice" });
  });
});
