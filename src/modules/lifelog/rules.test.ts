/** 0.5 أ.10 — القواعد النقية: 2 (حرفية المرشح)، 3 (غير المؤكَّد لا يدخل المصادر)، 5 (حياد الجنس)، 6 (المحتوى الممنوع)، 10 (التجديد)، 11 (التقادم). */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isVerbatim, normalizeForMatch, blockedReason, addItem, emptyLog, confirmAll, isStale, refreshDue, reaskDue, intakeDue, scenarioSources, templateEligible, pickSource, acceptRef, composeScenario, provenanceFor, suggestWindows, lifeConfig, type LifeLog } from "./rules";
import { applyIntakeRules, MAX_CANDIDATES } from "./intake-ai";
import { scenarioText } from "@/modules/library/scenario";
import content from "@content/life_log.ar.json";

const NOW = new Date("2026-11-11T09:00:00Z");
const iso = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();
const item = (id: string, text: string, daysAgo = 0) => ({ id, text, source: "user_typed" as const, confirmed_at: iso(daysAgo), last_confirmed_at: iso(daysAgo), archived: false });
const log = (o: Partial<LifeLog> = {}): LifeLog => ({ ...emptyLog(), ...o });

describe("أ.10-2: المرشح يجب أن يكون جزءًا حرفيًا من رسالة المستخدم", () => {
  const msg = "أُسلّم مشروع التخرج آخر الشهر، وأحضّر أخوي الصغير للمدرسة";
  it("التطبيع: التشكيل والألف والياء والتاء المربوطة", () => {
    expect(isVerbatim("اسلم مشروع التخرج اخر الشهر", msg)).toBe(true);
    expect(normalizeForMatch("مدرسةٌ على")).toBe("مدرسه علي");
  });
  it("مرشح مؤلَّف أو ملخَّص يُحذف، والحرفي يبقى؛ حقل غير مسموح وما زاد عن 3 يُحذف", () => {
    const r = applyIntakeRules({ candidates: [
      { field: "responsibilities", text: "أسلّم مشروع التخرج آخر الشهر" },
      { field: "responsibilities", text: "تسليم مشروع الجامعة" },            // تلخيص/تأليف
      { field: "xp_events", text: "أحضّر أخوي الصغير للمدرسة" },             // حقل غير مسموح
      { field: "responsibilities", text: "أحضّر أخوي الصغير للمدرسة" },
      { field: "responsibilities", text: "مشروع التخرج" }, { field: "responsibilities", text: "آخر الشهر" },
    ], follow_up: "متى موعد التسليم؟" }, { userMessage: msg, field: "responsibilities", existing: [] });
    expect(r.candidates.map((c) => c.text)).toEqual(["أسلّم مشروع التخرج آخر الشهر", "أحضّر أخوي الصغير للمدرسة", "مشروع التخرج"]);
    expect(r.candidates).toHaveLength(MAX_CANDIDATES);
    expect(r.dropped.map((d) => d.reason)).toEqual(["not_verbatim", "field_not_allowed", "max_candidates"]);
    expect(r.followUp).toBe("متى موعد التسليم؟");
  });
  it("المتابعة: سؤال واحد ≤ 80 حرفًا وإلا تُهمل", () => {
    const base = { candidates: [], follow_up: "" };
    expect(applyIntakeRules({ ...base, follow_up: "متى؟ وأين؟" }, { userMessage: "x", field: "roles", existing: [] }).followUp).toBeNull();
    expect(applyIntakeRules({ ...base, follow_up: `${"س".repeat(90)}؟` }, { userMessage: "x", field: "roles", existing: [] }).followUp).toBeNull();
  });
});

describe("أ.10-6: المحتوى الممنوع يُرفض بقائمة الكلمات ولا يصل للحفظ", () => {
  it("صحة، اسم غريب، موقع دقيق، دخل، رقم هاتف", () => {
    expect(blockedReason("عندي موعد دواء السكري")).toBe("health");
    expect(blockedReason("أدرس مع صديقي سامي")).toBe("non_family_person_names");
    expect(blockedReason("أروح على شارع الجامعة عمارة 12")).toBe("precise_locations");
    expect(blockedReason("راتبي ما بيكفي")).toBe("income");
    expect(blockedReason("اتصل على 0791234567")).toBe("phone");
    expect(blockedReason("أسلّم مشروع التخرج آخر الشهر")).toBeNull();
    expect(blockedReason("أحضّر أخوي الصغير للمدرسة")).toBeNull();
  });
  it("addItem يرفض الممنوع ولا يغيّر السجل، ويحترم حد 10 عناصر ويمنع التكرار", () => {
    const l = log();
    const bad = addItem(l, "responsibilities", "آخذ دواء الضغط", "user_typed", { id: "1", now: NOW.toISOString() });
    expect(bad).toMatchObject({ ok: false, reason: "blocked", blocked: "health" });
    let cur = l;
    for (let k = 0; k < lifeConfig.max_items_per_field; k++) { const r = addItem(cur, "roles", `دور ${k}`, "user_typed", { id: `r${k}`, now: NOW.toISOString() }); expect(r.ok).toBe(true); if (r.ok) cur = r.log; }
    expect(addItem(cur, "roles", "دور زائد", "user_typed", { id: "x", now: NOW.toISOString() })).toMatchObject({ ok: false, reason: "max_items" });
    const dup = addItem(cur, "roles", "دور 0", "user_typed", { id: "y", now: NOW.toISOString() });
    expect(dup.ok && dup.log.roles).toHaveLength(lifeConfig.max_items_per_field);
  });
});

describe("أ.10-3 و11: مصادر السيناريو", () => {
  const tasks = [
    { id: "t1", title: "اختبار الفيزياء", due_date: "2026-11-13", status: "open", created_via: "nlp" },
    { id: "t2", title: "بلا موعد", due_date: null, status: "open", created_via: "manual" },
    { id: "t3", title: "أضافها المربي", due_date: "2026-11-12", status: "open", created_via: "guardian" },
    { id: "t4", title: "منجزة", due_date: "2026-11-12", status: "done", created_via: "manual" },
  ];
  it("فقط مهام المخطط التي كتبها هو وفيها موعد، ثم عناصر السجل المؤكَّدة؛ لا اقتراح معلّق ولا حقل آخر", () => {
    const l = log({ responsibilities: [item("e1", "أسلّم مشروع التخرج آخر الشهر")], roles: [item("r1", "طالب")] });
    const s = scenarioSources({ plannerTasks: tasks, log: l, now: NOW, today: "2026-11-11" });
    expect(s).toEqual([{ ref_type: "planner_task", ref_id: "t1", text: "اختبار الفيزياء" }, { ref_type: "life_entry", ref_id: "e1", text: "أسلّم مشروع التخرج آخر الشهر" }]);
    // عنصر غير مؤكَّد (اقتراح معلّق) ليس في السجل أصلًا، فلا يظهر في مدخلات mission_selector
    expect(JSON.stringify(s)).not.toContain("اقتراح معلّق من المرافق");
  });
  it("عنصر مضى على تأكيده أكثر من 60 يومًا لا يُستخدم، ويعود بعد تأكيده بلمسة؛ والمؤرشف لا يُستخدم", () => {
    const old = item("e-old", "مسؤولية قديمة", lifeConfig.refresh.stale_after_days + 1);
    expect(isStale(old, NOW)).toBe(true);
    expect(isStale(item("e", "x", lifeConfig.refresh.stale_after_days - 1), NOW)).toBe(false);
    const l = log({ responsibilities: [old, { ...item("e-arch", "مؤرشفة"), archived: true }] });
    expect(scenarioSources({ plannerTasks: [], log: l, now: NOW, today: "2026-11-11" })).toEqual([]);
    const confirmed = confirmAll(l, NOW.toISOString());
    expect(scenarioSources({ plannerTasks: [], log: confirmed, now: NOW, today: "2026-11-11" }).map((x) => x.ref_id)).toEqual(["e-old"]);
  });
  it("الأهلية: none دائمًا؛ required يحتاج مصدرًا؛ optional يحتاج مصدرًا أو تعارفًا مكتملًا", () => {
    expect(templateEligible("none", 0, "skipped")).toBe(true);
    expect(templateEligible("required", 0, "done")).toBe(false);
    expect(templateEligible("required", 1, "skipped")).toBe(true);
    expect(templateEligible("optional", 0, "skipped")).toBe(false);
    expect(templateEligible("optional", 0, "not_started")).toBe(false);
    expect(templateEligible("optional", 0, "done")).toBe(true);
  });
  it("مرجع يقترحه النموذج خارج مصادر المستخدم يُهمل؛ والاختيار الحتمي يتجنب المستعمل", () => {
    const s = [{ ref_type: "life_entry" as const, ref_id: "e1", text: "أ" }, { ref_type: "life_entry" as const, ref_id: "e2", text: "ب" }];
    expect(acceptRef({ ref_type: "life_entry", ref_id: "someone-else" }, s)).toBeNull();
    expect(acceptRef({ ref_type: "life_entry", ref_id: "e2" }, s)?.text).toBe("ب");
    expect(pickSource(s, new Set(["life_entry:e1"]), 0)?.ref_id).toBe("e2");
    expect(pickSource([], new Set(), 0)).toBeNull();
    expect(provenanceFor(s[0]!)).toEqual([{ name: "life_entry_text", ref_type: "life_entry", ref_id: "e1" }]);
  });
});

describe("أ.10-5: نص الموقف يركّبه الخادم من قالب محايد في الجنس", () => {
  const gendered = /(أنتَ|أنتِ|كَ(?=\s|$)|كِ(?=\s|$)|عزيزي|عزيزتي|حكيتِ|حكيتَ|ي\s+يا|\bيا\s+(بطل|بطلة|صديقي|صديقتي))|(?<=\s)(اكتبي|اختاري|قرري|رتبي|نفذي|تتصرفي|تتصرفين|اكتب|اختر|قرر|رتب|نفذ)(?=\s|$|[.،؟])/u;
  it("قالب التركيب نفسه بلا صيغة مؤنث ولا مذكر، ويحمل نص العنصر وسؤال القالب فقط", () => {
    expect(content.scenario.template).toBe("حسب ما حكيت: {text}. {question}");
    expect(content.scenario.template.replace("{text}", "").replace("{question}", "")).not.toMatch(gendered);
    expect(composeScenario("عندي اختبار يوم الخميس وما بدأت.", "ما الخطة؟")).toBe("حسب ما حكيت: عندي اختبار يوم الخميس وما بدأت. ما الخطة؟");
  });
  it("أسئلة القوالب required محايدة في الجنس، ونصها لا يحمل موقفًا من خيال النظام", () => {
    const dir = path.resolve(__dirname, "../../../content/templates");
    const required = readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"))).filter((t) => t.life_binding === "required");
    expect(required.length).toBeGreaterThan(0);
    for (const t of required) for (const q of Object.values(t.situation as Record<string, string>)) {
      expect(q, t.id).not.toMatch(gendered);
      expect(q, t.id).not.toMatch(/غرفتك|حقيبتك|واجبك|مدرستك/);
    }
  });
  it("المهمة المربوطة تُعرض مركَّبة، وغير المربوطة بنص القالب", () => {
    const tpl = { situation: { child: "ما المهم أولًا؟", teen: "ما المهم أولًا؟", adult: "ما الأهم أولًا؟" }, life_binding: "required" as const };
    expect(scenarioText(tpl, "teen", { life_entry_text: "عندي اختبار يوم الخميس" })).toBe("حسب ما حكيت: عندي اختبار يوم الخميس. ما المهم أولًا؟");
    expect(scenarioText({ ...tpl, life_binding: "none" }, "teen", { life_entry_text: "x" })).toBe("ما المهم أولًا؟");
  });
});

describe("أ.10-10: التجديد وإعادة السؤال", () => {
  it("يستحق كل life_refresh_days بعد إتمام التعارف فقط", () => {
    const base = { intakeStatus: "done" as const, intakeCompletedAt: iso(14), lastRefreshAt: null, everyDays: 14, now: NOW };
    expect(refreshDue(base)).toBe(true);
    expect(refreshDue({ ...base, intakeCompletedAt: iso(13) })).toBe(false);
    expect(refreshDue({ ...base, lastRefreshAt: iso(2) })).toBe(false);
    expect(refreshDue({ ...base, intakeStatus: "skipped" })).toBe(false);
  });
  it("«ما تغيّر» يجدد last_confirmed_at فقط: النصوص والمصدر وتاريخ التأكيد الأول كما هي", () => {
    const l = log({ responsibilities: [item("e1", "أ", 20)], roles: [item("r1", "ب", 30)] });
    const after = confirmAll(l, NOW.toISOString());
    for (const f of ["responsibilities", "roles"] as const) {
      const { last_confirmed_at: _a, ...restBefore } = l[f][0]!; const { last_confirmed_at: b, ...restAfter } = after[f][0]!;
      void _a; expect(restAfter).toEqual(restBefore); expect(b).toBe(NOW.toISOString());
    }
  });
  it("بعد التخطي يُعاد السؤال بلطف بعد reask_after_days", () => {
    expect(reaskDue({ intakeStatus: "skipped", skippedAt: iso(lifeConfig.intake.reask_after_days), now: NOW })).toBe(true);
    expect(intakeDue({ intakeStatus: "skipped", skippedAt: iso(1), now: NOW })).toBe(false);
    expect(intakeDue({ intakeStatus: "not_started", skippedAt: null, now: NOW })).toBe(true);
    expect(intakeDue({ intakeStatus: "done", skippedAt: null, now: NOW })).toBe(false);
  });
  it("اقتراح النوافذ المتاحة من الالتزامات", () => {
    expect(suggestWindows([{ from: "08:00", to: "14:00" }, { from: "16:00", to: "18:00" }], "22:00", 60)).toEqual([{ from: "18:00", to: "22:00" }]);
    expect(suggestWindows([{ from: "08:00", to: "21:30" }], "22:00", 60)).toEqual([]);
  });
});
