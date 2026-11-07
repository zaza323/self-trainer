/** ب.15 المرحلة 11 + ط.12-3/4: ذكاء المخطط يتراجع مع التحسن، ومخرجاته متحققة أو حتمية. */
import { describe, it, expect } from "vitest";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { fakeCaller } from "@/modules/companion/runtime";
import { taskBreakdown, dayPlanner, dayReconstructor, taskParserFallback, weeklyReviewWording, verifyReviewWording, mergeParsed } from "./ai";
import { parseQuickAdd } from "./nlp";
import { planDay } from "./day-plan";
import content from "@content/planner.ar.json";

const db = () => new FakeDb().client();
const task = { title: "تحضير عرض المشروع", notes: null };
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("task_breakdown بالتدرج", () => {
  it("L2: لا يُرجع أي خطوة ولا يستدعي النموذج قبل أن يكتب المستخدم خطوة", async () => {
    const caller = fakeCaller([JSON.stringify({ steps: [{ title: "x", estimate_min: null }], note: null })]);
    const r = await taskBreakdown({ db: db(), caller, profileId: "p", mode: "teen", level: "L2_ask", task, userSteps: [] });
    expect(r.kind).toBe("ask_first"); expect(r.steps).toEqual([]); expect(r.question).toBe(content.ai.breakdown.ask_first);
    expect(caller.calls).toHaveLength(0);
    const r3 = await taskBreakdown({ db: db(), caller, profileId: "p", mode: "adult", level: "L3_free", task, userSteps: ["  "] });
    expect(r3.kind).toBe("ask_first"); expect(caller.calls).toHaveLength(0);
  });
  it("L2 بعد خطوة المستخدم: حتى خطوتين ناقصتين؛ ثلاث أو تكرار خطوته مرفوض ⇒ لا خطوات", async () => {
    const two = JSON.stringify({ steps: [{ title: "اجمع المراجع", estimate_min: 20 }, { title: "جرّب العرض بصوت عالٍ", estimate_min: 15 }], note: null });
    const ok = await taskBreakdown({ db: db(), caller: fakeCaller([two]), profileId: "p", mode: "teen", level: "L2_ask", task, userSteps: ["أكتب المخطط"] });
    expect(ok.kind).toBe("suggest"); expect(ok.steps).toHaveLength(2); expect(ok.source).toBe("ai");
    const three = JSON.stringify({ steps: [{ title: "أ", estimate_min: null }, { title: "ب", estimate_min: null }, { title: "ج", estimate_min: null }], note: null });
    const repeat = JSON.stringify({ steps: [{ title: "أكتب المخطط", estimate_min: null }], note: null });
    const bad = await taskBreakdown({ db: db(), caller: fakeCaller([three, repeat]), profileId: "p", mode: "teen", level: "L2_ask", task, userSteps: ["أكتب المخطط"] });
    expect(bad.steps).toEqual([]); expect(bad.source).toBe("fixed");
  });
  it("L0–L1: مسودة حتى 5 خطوات؛ 6 مرفوضة", async () => {
    const five = JSON.stringify({ steps: [1, 2, 3, 4, 5].map((n) => ({ title: `خطوة ${n}`, estimate_min: 10 })), note: null });
    const r = await taskBreakdown({ db: db(), caller: fakeCaller([five]), profileId: "p", mode: "child", level: "L1_hint", task, userSteps: [] });
    expect(r.kind).toBe("draft"); expect(r.steps).toHaveLength(5);
    const six = JSON.stringify({ steps: [1, 2, 3, 4, 5, 6].map((n) => ({ title: `خطوة ${n}`, estimate_min: 10 })), note: null });
    const r2 = await taskBreakdown({ db: db(), caller: fakeCaller([six, six]), profileId: "p", mode: "child", level: "L0_instruct", task, userSteps: [] });
    expect(r2.steps).toEqual([]);
  });
});

describe("day_planner بالتدرج", () => {
  const tasks = [
    { id: ID(1), title: "اجتماع", priority: "medium" as const, due_date: "2026-11-07", due_time: "15:00:00", estimate_min: 60 },
    { id: ID(2), title: "تقرير", priority: "high" as const, due_date: "2026-11-07", due_time: null, estimate_min: 90 },
    { id: ID(3), title: "بريد", priority: "low" as const, due_date: null, due_time: null, estimate_min: 20 },
  ];
  it("L0–L1 ترتيب كامل حتمي: الوقت الثابت يبقى، الأعلى أولوية أولًا، بلا تداخل مع المشغول", () => {
    const r = planDay({ mode: "propose_full_order", tasks, today: "2026-11-07", nowMin: 9 * 60, busy: [{ start: 9 * 60, end: 10 * 60 }] });
    expect(r.ok && r.placements.map((p) => [p.task_id, p.start])).toEqual([[ID(2), "10:05"], [ID(3), "11:40"], [ID(1), "15:00"]]);
  });
  it("L2: بلا اختيار ⇒ يطلب اختيار 1–3 ولا يقترح شيئًا؛ مع اختيار يضع المختار فقط", async () => {
    const none = await dayPlanner({ db: db(), caller: fakeCaller([]), profileId: "p", mode: "teen", level: "L2_ask", tasks, today: "2026-11-07", nowMin: 540, busy: [] });
    expect(none.ok).toBe(false);
    const ai = JSON.stringify({ placements: [{ task_id: ID(3), start: "09:30" }], note: null });
    const r = await dayPlanner({ db: db(), caller: fakeCaller([ai]), profileId: "p", mode: "teen", level: "L2_ask", tasks, picks: [ID(3)], today: "2026-11-07", nowMin: 540, busy: [] });
    expect(r.ok && r.placements.map((p) => p.task_id)).toEqual([ID(3)]);
    expect(r.ok && r.source).toBe("ai");
  });
  it("مخرج يضع مهمة غير مختارة يُرفض ⇒ الاحتياطي الحتمي", async () => {
    const bad = JSON.stringify({ placements: [{ task_id: ID(2), start: "09:30" }], note: null });
    const r = await dayPlanner({ db: db(), caller: fakeCaller([bad, bad]), profileId: "p", mode: "teen", level: "L3_free", tasks, picks: [ID(3)], today: "2026-11-07", nowMin: 540, busy: [] });
    expect(r.ok && r.source).toBe("deterministic"); expect(r.ok && r.placements.map((p) => p.task_id)).toEqual([ID(3)]);
  });
});

describe("day_reconstructor (ط.12-3/4)", () => {
  const cats = ["sleep", "phone_screens", "study", "meals", "unknown"];
  it("مخرج نموذج يخترع وقتًا لم يُذكر يُرفض ⇒ المحلّل الحتمي: مقطعان بأوقاتهما", async () => {
    const invented = JSON.stringify({ blocks: [{ start: "00:00", end: "09:00", category: "sleep", label: null, confidence: 0.9 }, { start: "09:00", end: "11:00", category: "phone_screens", label: null, confidence: 0.9 }, { start: "11:00", end: "13:30", category: "study", label: null, confidence: 0.4 }], gaps: [] });
    const r = await dayReconstructor({ db: db(), caller: fakeCaller([invented, invented]), profileId: "p", mode: "teen", text: "صحيت 9 وقعدت عالجوال لـ 11", categories: cats, knownBoundaries: [], nowHHMM: null });
    expect(r.source).toBe("deterministic");
    expect(r.blocks.map((b) => [b.category, b.start, b.end])).toEqual([["sleep", "00:00", "09:00"], ["phone_screens", "09:00", "11:00"]]);
  });
  it("مخرج صالح يُقبل كما هو (للمعاينة فقط)", async () => {
    const ok = JSON.stringify({ blocks: [{ start: "09:00", end: "11:00", category: "phone_screens", label: "جوال", confidence: 0.8 }], gaps: [{ start: "00:00", end: "09:00" }] });
    const r = await dayReconstructor({ db: db(), caller: fakeCaller([ok]), profileId: "p", mode: "teen", text: "من 9 لـ 11 عالجوال", categories: cats, knownBoundaries: [], nowHHMM: null });
    expect(r.source).toBe("ai"); expect(r.blocks).toHaveLength(1);
  });
  it("المساعد معطّل ⇒ الحتمي", async () => {
    const r = await dayReconstructor({ db: db(), caller: fakeCaller([], { enabled: false }), profileId: "p", mode: "teen", text: "صحيت 9 وقعدت عالجوال لـ 11", categories: cats, knownBoundaries: [], nowHHMM: null });
    expect(r.blocks).toHaveLength(2);
  });
});

describe("task_parser الاحتياطي", () => {
  const ctx = { today: "2026-11-07", ambiguousPmUntil: 7, weekStart: "sat" as const };
  it("ما فهمه المحلّل الحتمي يغلب؛ النموذج يملأ الناقص", () => {
    const det = parseQuickAdd("اجتماع بكرا #عمل", ctx);
    const m = mergeParsed(det, { title: "اجتماع الفريق", due_date: "2026-11-20", due_time: "10:00", priority: "high", tags: ["x"], project: null, estimate_min: 30, reminder_offset_min: null });
    expect(m.due_date).toBe(det.due_date); expect(m.tags).toEqual(det.tags); expect(m.due_time).toBe("10:00"); expect(m.priority).toBe("high");
  });
  it("تاريخ في الماضي بلا «امبارح» يُرفض ⇒ يبقى الحتمي", async () => {
    const det = parseQuickAdd("شي غامض 3 4 5", ctx);
    const past = JSON.stringify({ title: "شي", due_date: "2026-11-01", due_time: null, priority: "none", tags: [], project: null, estimate_min: null, reminder_offset_min: null });
    const r = await taskParserFallback({ db: db(), caller: fakeCaller([past, past]), profileId: "p", mode: "adult", text: "شي غامض 3 4 5", ctx, deterministic: det });
    expect(r.source).toBe("deterministic");
  });
});

describe("weekly_review صياغة فقط", () => {
  it("رقم مخترع أو مقارنة بالآخرين يُرفض", () => {
    expect(verifyReviewWording({ intro: "خلصت 5 مهام", increment_line: null }, "خلصت 4 مهام")).toBe("invented_number");
    expect(verifyReviewWording({ intro: "أحسن من غيرك", increment_line: null }, "")).toBe("comparison_with_others");
    expect(verifyReviewWording({ intro: "خلصت 4 مهام", increment_line: null }, "خلصت 4 مهام")).toBeNull();
  });
  it("السقوط إلى النص الثابت", async () => {
    const r = await weeklyReviewWording({ db: db(), caller: fakeCaller([], { enabled: false }), profileId: "p", mode: "teen", facts: "x", fallback: { intro: "ثابت", incrementLine: null } });
    expect(r).toEqual({ intro: "ثابت", incrementLine: null, source: "fixed" });
  });
});
