/** 0.5 الجزء ب — اختبارات القواعد النقية: ب.11-1 (ذهبية)، 2 (الأسبقية)، 4 (الحدود)، 5 (التوصية)، 7 (منع التأثر)، 9 (كشف المراجعة)، 12 (لا مقارنة بين مستخدمين). */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { margins } from "@/shared/config";
import { systemDefault, normalizeSetValue, normalizeTitle, plannerSimilarity, missionSimilarity, recommend, resolveMargin, hiddenUntilEstimate, reviewKey, reviewText, followupAfterMin, type MarginEventLite, type ResolveInput, type RuleLite } from "./rules";

const none = { actuals: [] as number[], userEstimate: null, templateRange: null, freeGapMin: null };

describe("ب.11-1: الأمثلة المحلولة السبعة في ب.4 (ذهبية)", () => {
  it("بالغ، أزمنة (20، 24، 30)، دعم L3 ⇒ 30", () => expect(systemDefault({ ...none, mode: "adult", supportLevel: "L3_free", actuals: [20, 24, 30] })).toMatchObject({ value: 30, basis: "history_actuals" }));
  it("طفل، أزمنة (10، 12، 14)، دعم L1 ⇒ 20", () => expect(systemDefault({ ...none, mode: "child", supportLevel: "L1_hint", actuals: [10, 12, 14] }).value).toBe(20));
  it("مراهق، بلا أزمنة، قدّر 20، دعم L2 ⇒ 25", () => expect(systemDefault({ ...none, mode: "teen", supportLevel: "L2_ask", userEstimate: 20 })).toMatchObject({ value: 25, basis: "user_estimate" }));
  it("طفل، قالب 10–20، بلا بيانات ⇒ 20", () => expect(systemDefault({ ...none, mode: "child", supportLevel: "L1_hint", templateRange: { min: 10, max: 20 } })).toMatchObject({ value: 20, basis: "template_range" }));
  it("بالغ، لا شيء ⇒ 25", () => expect(systemDefault({ ...none, mode: "adult", supportLevel: "L3_free" })).toMatchObject({ value: 25, basis: "age_default" }));
  it("بالغ، الحساب 25 لكن الفجوة 15 ⇒ 15", () => expect(systemDefault({ ...none, mode: "adult", supportLevel: "L3_free", freeGapMin: 15 }).value).toBe(15));
  it("طفل، وسيط 80، دعم L0 ⇒ 90 (108 ← 110 ← قص)", () => expect(systemDefault({ ...none, mode: "child", supportLevel: "L0_instruct", actuals: [80, 80, 80] }).value).toBe(90));
  it("أقل من min_samples أزمنة لا تُستخدم", () => expect(systemDefault({ ...none, mode: "adult", supportLevel: "L3_free", actuals: [60, 60] }).basis).toBe("age_default"));
});

describe("ب.11-4: الحدود والتقريب", () => {
  it("خارج حدود الوضع تُقصّ، وغير مضاعف الخمس تُقرَّب لأعلى", () => {
    expect(normalizeSetValue(500, "child")).toBe(margins.bounds_min.child.max);
    expect(normalizeSetValue(500, "teen")).toBe(margins.bounds_min.teen.max);
    expect(normalizeSetValue(500, "adult")).toBe(margins.bounds_min.adult.max);
    expect(normalizeSetValue(1, "adult")).toBe(margins.bounds_min.adult.min);
    expect(normalizeSetValue(22, "teen")).toBe(25);
    expect(normalizeSetValue(25, "teen")).toBe(25);
  });
});

describe("ب.5: التطبيع الحتمي ومفاتيح التشابه", () => {
  it("أحرف صغيرة، بلا أرقام ولا كلمات وقت ولا تشكيل، وتوحيد الألف والياء والتاء المربوطة", () => {
    expect(normalizeTitle("مُراجعة الرياضيات 30 دقيقة اليوم")).toBe(normalizeTitle("مراجعه الرياضيات"));
    expect(normalizeTitle("أكتب إلى المعلّمة ٢")).toBe("اكتب الي المعلمه");
    expect(normalizeTitle("Read Chapter 3 today")).toBe("read chapter");
  });
  it("L1 للمخطط = العنوان المطبَّع، L2 = المشروع والوسوم (بترتيب ثابت)؛ وللمهمة التدريبية القالب ثم القدرة+الميكانيكية", () => {
    expect(plannerSimilarity({ title: "مراجعة الرياضيات 20 دقيقة", project_id: "p1", tag_ids: ["b", "a"] })).toEqual({ l1: "title:مراجعه الرياضيات", l2: "proj:p1|tags:a,b" });
    expect(plannerSimilarity({ title: "x", project_id: null, tag_ids: [] }).l2).toBeNull();
    expect(missionSimilarity({ template_id: "rd-sim-01", capability_id: "attention", mechanic: "resist_distraction" })).toEqual({ l1: "tpl:rd-sim-01", l2: "cap:attention|mech:resist_distraction" });
  });
});

const NOW = new Date("2026-11-11T10:00:00Z");
const ev = (min: number, daysAgo: number, o: Partial<MarginEventLite> = {}): MarginEventLite => ({ profile_id: "P", similarity: { l1: "tpl:a", l2: "cap:x|mech:y" }, set_min: min, created_at: new Date(NOW.getTime() - daysAgo * 86400000).toISOString(), guardian_link_id: "g1", ...o });
const ctx = { profileId: "P", sim: { l1: "tpl:a", l2: "cap:x|mech:y" }, now: NOW, creatorLinkId: null as string | null, mode: "teen" as const };

describe("ب.11-5: التوصية", () => {
  it("وسيط آخر 3 تعديلات على L1 (الأقدم خارج النافذة لا يدخل)", () => {
    expect(recommend([ev(60, 9), ev(20, 3), ev(30, 2), ev(40, 1)], ctx)).toEqual({ value: 30, level: "L1", n: 3 });
  });
  it("تعديل واحد يكفي؛ ولا شيء على L1 ⇒ L2؛ وبلا تعديلات ⇒ لا توصية", () => {
    expect(recommend([ev(35, 1)], ctx)).toEqual({ value: 35, level: "L1", n: 1 });
    expect(recommend([ev(45, 1, { similarity: { l1: "tpl:other", l2: "cap:x|mech:y" } })], ctx)).toEqual({ value: 45, level: "L2", n: 1 });
    expect(recommend([], ctx)).toBeNull();
    expect(recommend([ev(45, 1, { similarity: { l1: "tpl:other", l2: "cap:z|mech:y" } })], ctx)).toBeNull();
  });
  it("أقدم من lookback_days لا يُحسب", () => expect(recommend([ev(45, margins.history.lookback_days + 1)], ctx)).toBeNull());
  it("إن اختلف المربون: المنشئ أولًا ثم الأحدث", () => {
    const events = [ev(50, 5, { guardian_link_id: "creator" }), ev(20, 1, { guardian_link_id: "teacher" })];
    expect(recommend(events, { ...ctx, creatorLinkId: "creator" })!.value).toBe(50);
    expect(recommend(events, ctx)!.value).toBe(35);
  });
  it("ب.11-12: حدث لمستخدم آخر يُرفض (لا مقارنة بين مستخدمين)", () => {
    expect(() => recommend([ev(30, 1), ev(30, 1, { profile_id: "OTHER" })], ctx)).toThrow(/another profile/);
  });
});

const sys = systemDefault({ ...none, mode: "teen", supportLevel: "L2_ask" });
const rule = (o: Partial<RuleLite>): RuleLite => ({ id: "r", similarity_key: "tpl:a", level: "L1", margin_min: 40, set_by: "G", guardian_link_id: "g1", is_creator: false, updated_at: "2026-11-01T00:00:00Z", ...o });
const input = (o: Partial<ResolveInput>): ResolveInput => ({ mode: "child", sim: { l1: "tpl:a", l2: "cap:x|mech:y" }, task: { margin_min: null, margin_source: null, margin_set_by: null }, rules: [], recommendation: null, historyMode: "prefill", system: sys, ...o });
const rec = { value: 35, level: "L1" as const, n: 2 };

describe("ب.11-2: الأسبقية", () => {
  it("child: تعديل المهمة > القاعدة > التوصية > الافتراضي", () => {
    const all = { task: { margin_min: 50, margin_source: "guardian" as const, margin_set_by: "G" }, rules: [rule({})], recommendation: rec };
    expect(resolveMargin(input(all))).toMatchObject({ margin_min: 50, source: "guardian", set_by: "G", rule: "margin_guardian_this_task" });
    expect(resolveMargin(input({ ...all, task: { margin_min: null, margin_source: null, margin_set_by: null } }))).toMatchObject({ margin_min: 40, source: "guardian_rule" });
    expect(resolveMargin(input({ recommendation: rec }))).toMatchObject({ margin_min: 35, source: "history", rule: "margin_history" });
    expect(resolveMargin(input({}))).toMatchObject({ margin_min: sys.value, source: "system", rule: "margin_default_age_default" });
  });
  it("child: تعديل للمستخدم لا يُعتدّ به (الطفل يرى فقط)", () => {
    expect(resolveMargin(input({ task: { margin_min: 10, margin_source: "user", margin_set_by: "U" }, rules: [rule({})] })).source).toBe("guardian_rule");
  });
  it("teen: المستخدم أولًا حتى مع تعديل مربٍّ وقاعدة", () => {
    const r = resolveMargin(input({ mode: "teen", task: { margin_min: 30, margin_source: "user", margin_set_by: "U" }, rules: [rule({})], recommendation: rec }));
    expect(r).toMatchObject({ margin_min: 30, source: "user", set_by: "U" });
    expect(resolveMargin(input({ mode: "teen", rules: [rule({}), rule({ id: "own", guardian_link_id: null, set_by: "U", margin_min: 15 })] }))).toMatchObject({ margin_min: 15, source: "user" });
    expect(resolveMargin(input({ mode: "teen", task: { margin_min: 55, margin_source: "guardian", margin_set_by: "G" }, rules: [rule({})] }))).toMatchObject({ margin_min: 55, source: "guardian" });
  });
  it("بين قواعد المربين: child المنشئ أولًا ثم الأحدث؛ teen الأحدث", () => {
    const rules = [rule({ id: "c", is_creator: true, margin_min: 60, updated_at: "2026-10-01T00:00:00Z" }), rule({ id: "t", margin_min: 20, updated_at: "2026-11-05T00:00:00Z" })];
    expect(resolveMargin(input({ rules })).margin_min).toBe(60);
    expect(resolveMargin(input({ mode: "teen", rules })).margin_min).toBe(20);
  });
  it("قاعدة L1 تغلب قاعدة L2", () => {
    expect(resolveMargin(input({ rules: [rule({ level: "L2", similarity_key: "cap:x|mech:y", margin_min: 70, updated_at: "2026-11-09T00:00:00Z" }), rule({})] })).margin_min).toBe(40);
  });
});

describe("ب.11-5: أوضاع التوصية الثلاثة", () => {
  it("prefill تُملأ؛ suggest_only تُعرض كاقتراح ولا تُملأ؛ off لا شيء", () => {
    expect(resolveMargin(input({ recommendation: rec, historyMode: "prefill" }))).toMatchObject({ margin_min: 35, source: "history", suggestion: null });
    expect(resolveMargin(input({ recommendation: rec, historyMode: "suggest_only" }))).toMatchObject({ margin_min: sys.value, source: "system", suggestion: rec });
    expect(resolveMargin(input({ recommendation: rec, historyMode: "off" }))).toMatchObject({ margin_min: sys.value, source: "system", suggestion: null });
  });
});

describe("ب.11-7: منع التأثر", () => {
  it("عند L2 فما فوق للتخطيط الهامش مخفي حتى يُدخل تقديره؛ وعند L0–L1 ظاهر", () => {
    expect(hiddenUntilEstimate("L2_ask", false)).toBe(true);
    expect(hiddenUntilEstimate("L3_free", false)).toBe(true);
    expect(hiddenUntilEstimate("L2_ask", true)).toBe(false);
    expect(hiddenUntilEstimate("L0_instruct", false)).toBe(false);
    expect(hiddenUntilEstimate("L1_hint", false)).toBe(false);
  });
});

describe("ب.11-9: كشف المراجعة بالقواعد", () => {
  const k = { similarity_key: "tpl:a", level: "L1" as const, subject_type: "mission" as const, mode: "teen" as const };
  it("5 إنجازات بوسيط 1.4× الهامش ⇒ ضيق، والمقترح = الوسيط × (1 + هامش العمر)", () => {
    const f = reviewKey({ ...k, actuals: [28, 28, 28, 28, 28], margin_min: 20 })!;
    expect(f).toMatchObject({ kind: "tight", n: 5, median_actual: 28, margin_min: 20, proposed_min: 35 });
    expect(reviewText(f)).toBe("آخر 5 مرات احتاج 28 دقيقة والهامش 20. تعدّله؟");
  });
  it("أقل من 0.5 ⇒ واسع؛ بين الحدّين أو أقل من 5 إنجازات ⇒ لا شيء", () => {
    expect(reviewKey({ ...k, actuals: [8, 8, 8, 8, 8], margin_min: 40 })).toMatchObject({ kind: "loose", proposed_min: 10 });
    expect(reviewKey({ ...k, actuals: [22, 22, 22, 22, 22], margin_min: 20 })).toBeNull();
    expect(reviewKey({ ...k, actuals: [28, 28, 28, 28], margin_min: 20 })).toBeNull();
  });
});

describe("ب.6: الهامش معزول", () => {
  it("بطاقة «تمّت؟» بعد نهاية الهامش والزيادات ومهلة المتابعة", () => expect(followupAfterMin(25, 10, 5)).toBe(40));
  it("وحدات الأدلة والنقاط والبوابات والتحديات لا تستورد وحدة الهامش ولا تقرأ أعمدته", () => {
    const root = path.resolve(__dirname, "..");
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(d, e.name)] : []);
    const guarded = ["evidence", "game", "challenges"].flatMap((m) => walk(path.join(root, m))).concat([path.join(root, "planner/xp-service.ts"), path.join(root, "planner/evidence-service.ts"), path.join(root, "planner/evidence-values.ts")]);
    expect(guarded.length).toBeGreaterThan(10);
    for (const f of guarded) expect(readFileSync(f, "utf8"), f).not.toMatch(/modules\/margins|margin_min|margin_extra_min|margin_source/);
  });
  it("ب.11-12: استعلامات وحدة الهامش على margin_events مقيّدة دائمًا بمتدرب واحد", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((x) => /\.ts$/.test(x) && !/\.test\./.test(x))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      for (const m of src.matchAll(/from\("margin_events"\)[^;]*;/g)) expect(m[0], `${f}: ${m[0]}`).toMatch(/\.eq\("profile_id",/);
    }
  });
});
