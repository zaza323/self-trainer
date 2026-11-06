/** اختبارات المرحلة 9 (0.4 ب): المحلّل الحتمي (أمثلة ب.4 حرفيًا)، التكرار، مستويات الأدوات، العروض. */
import { describe, it, expect } from "vitest";
import { parseQuickAdd, needsAiFallback, resolveHour, type ParseContext } from "./nlp";
import { nextOccurrence, parseRRule, serializeRRule, workdays, nextMatching } from "./recurrence";
import { plannerTier, earnedTier, hasTool, toolsForTier } from "./tiers";
import { groupTasks, applyFilter } from "./views";
import { planner, customization } from "@/shared/config";
import type { PlannerTaskRow } from "./types";

// 2026-11-05 هو الخميس
const ctx: ParseContext = { today: "2026-11-05", ambiguousPmUntil: customization.catalog.ambiguous_hour_pm_until!.default.teen as number, weekStart: "sat" };

describe("ب.4 الأمثلة الثابتة الخمسة", () => {
  it("اجتماع بكرا الساعة 5 #عمل ⇒ عنوان «اجتماع»، الغد 17:00، وسم عمل", () => {
    const p = parseQuickAdd("اجتماع بكرا الساعة 5 #عمل", ctx);
    expect(p).toMatchObject({ title: "اجتماع", due_date: "2026-11-06", due_time: "17:00", tags: ["عمل"], recurrence: null, priority: "none", reminder: null });
    expect(needsAiFallback(p)).toBe(false);
  });
  it("ذكرني أتصل بالعميل بكرا 3 ⇒ «أتصل بالعميل»، الغد 15:00، تذكير عند الموعد", () => {
    const p = parseQuickAdd("ذكرني أتصل بالعميل بكرا 3", ctx);
    expect(p).toMatchObject({ title: "أتصل بالعميل", due_date: "2026-11-06", due_time: "15:00", reminder: { offset_min: 0 } });
  });
  it("رياضة كل أحد وثلاثاء 7 الصبح ⇒ تكرار الأحد والثلاثاء 07:00", () => {
    const p = parseQuickAdd("رياضة كل أحد وثلاثاء 7 الصبح", ctx);
    expect(p.title).toBe("رياضة");
    expect(p.recurrence).toEqual({ kind: "weekly", byday: [0, 2] });
    expect(p.due_time).toBe("07:00");
    expect(p.recur_from).toBe("schedule");
    expect(p.due_date).toBe("2026-11-08"); // أول أحد بعد الخميس
  });
  it("مراجعة الفصل كل 3 أيام !عالية ⇒ كل 3 أيام من الإنجاز، أولوية عالية", () => {
    const p = parseQuickAdd("مراجعة الفصل كل 3 أيام !عالية", ctx);
    expect(p).toMatchObject({ title: "مراجعة الفصل", recurrence: { kind: "every_n_days", n: 3 }, recur_from: "completion", priority: "high" });
  });
  it("تقرير الجمعة لمدة 45 دقيقة /الجامعة ⇒ الجمعة القادمة، مدة 45، مشروع الجامعة", () => {
    const p = parseQuickAdd("تقرير الجمعة لمدة 45 دقيقة /الجامعة", ctx);
    expect(p).toMatchObject({ title: "تقرير", due_date: "2026-11-06", estimate_min: 45, project: "الجامعة" });
  });
});

describe("المحلّل: حالات إضافية", () => {
  it("إنجليزي، تاريخ رقمي، !1، قبل بساعة، الظهر، بعد بكرا", () => {
    expect(parseQuickAdd("call mom tomorrow at 5pm #family", ctx)).toMatchObject({ title: "call mom", due_date: "2026-11-06", due_time: "17:00", tags: ["family"] });
    expect(parseQuickAdd("دفع الفاتورة 5/11", ctx)).toMatchObject({ title: "دفع الفاتورة", due_date: "2026-11-05" });
    expect(parseQuickAdd("دفع الفاتورة 1/11", ctx).due_date).toBe("2027-11-01"); // مضى هذا العام ⇒ العام القادم
    expect(parseQuickAdd("واجب !1 بعد بكرا الظهر", ctx)).toMatchObject({ title: "واجب", priority: "high", due_date: "2026-11-07", due_time: `${planner.nlp.period_hours.noon}:00` });
    expect(parseQuickAdd("ذكرني موعد الطبيب الأحد الجاي الساعة 10 الصبح قبل بساعة", ctx)).toMatchObject({ title: "موعد الطبيب", due_date: "2026-11-08", due_time: "10:00", reminder: { offset_min: 60 } });
    expect(parseQuickAdd("قراءة كل يوم 9 المسا", ctx)).toMatchObject({ recurrence: { kind: "daily" }, due_time: "21:00", due_date: "2026-11-05" });
    expect(parseQuickAdd("صلاة الفجر كل يوم دوام", ctx).recurrence).toEqual({ kind: "weekdays" });
    expect(parseQuickAdd("تنظيف كل أسبوع", ctx).recurrence).toEqual({ kind: "weekly", byday: [4] }); // يوم اليوم (الخميس)
    expect(parseQuickAdd("إيجار كل شهر 1/12", ctx).recurrence).toEqual({ kind: "monthly_day", day: 1 });
    expect(parseQuickAdd("اجتماع 17:30", ctx).due_time).toBe("17:30");
    expect(parseQuickAdd("اجتماع 10 الصبح", ctx).due_time).toBe("10:00");
    expect(parseQuickAdd("مذاكرة الساعة 8", ctx).due_time).toBe("08:00"); // 8 > pm_until ⇒ صباحًا كما هو
  });
  it("الساعة الغامضة تُفهم مساءً حتى الحد، والإعداد يغيّر الحد", () => {
    expect(resolveHour(5, null, 7)).toBe(17);
    expect(resolveHour(8, null, 7)).toBe(8);
    expect(resolveHour(8, null, 9)).toBe(20);
    expect(resolveHour(12, "am", 7)).toBe(0);
    expect(resolveHour(12, "pm", 7)).toBe(12);
    expect(parseQuickAdd("مذاكرة الساعة 8", { ...ctx, ambiguousPmUntil: 9 }).due_time).toBe("20:00");
  });
  it("الثقة تنخفض مع البقايا غير المفهومة وتطلب الذكاء الاصطناعي؛ العنوان الفارغ منخفض", () => {
    const vague = parseQuickAdd("شي كل الساعة", ctx);
    expect(vague.confidence).toBeLessThan(planner.nlp.ai_fallback_below_confidence);
    expect(needsAiFallback(vague)).toBe(true);
    expect(parseQuickAdd("بكرا", ctx).confidence).toBeLessThan(planner.nlp.ai_fallback_below_confidence);
    expect(needsAiFallback(parseQuickAdd("أشتري خبز", ctx))).toBe(false);
  });
});

describe("التكرار (ب.3، ب.18-2)", () => {
  it("كل 3 أيام من الإنجاز: أُنجزت متأخرة يومين ⇒ التالية بعد 3 أيام من تاريخ الإنجاز", () => {
    expect(nextOccurrence({ rrule: "FREQ=DAILY;INTERVAL=3", recurFrom: "completion", dueDate: "2026-11-05", completedOn: "2026-11-07", weekStart: "sat" })).toBe("2026-11-10");
  });
  it("من الجدول: التالية بعد الاستحقاق، وتقفز فوق ما فات إن أُنجزت متأخرة كثيرًا", () => {
    expect(nextOccurrence({ rrule: "FREQ=DAILY;INTERVAL=3", recurFrom: "schedule", dueDate: "2026-11-05", completedOn: "2026-11-05", weekStart: "sat" })).toBe("2026-11-08");
    expect(nextOccurrence({ rrule: "FREQ=DAILY;INTERVAL=3", recurFrom: "schedule", dueDate: "2026-11-05", completedOn: "2026-11-14", weekStart: "sat" })).toBe("2026-11-17");
    expect(nextOccurrence({ rrule: "FREQ=WEEKLY;BYDAY=SU,TU", recurFrom: "schedule", dueDate: "2026-11-08", completedOn: "2026-11-08", weekStart: "sat" })).toBe("2026-11-10");
    expect(nextOccurrence({ rrule: "FREQ=MONTHLY;BYMONTHDAY=31", recurFrom: "schedule", dueDate: "2026-01-31", completedOn: "2026-01-31", weekStart: "sat" })).toBe("2026-02-28");
    expect(nextOccurrence({ rrule: null, recurFrom: "schedule", dueDate: "2026-11-05", completedOn: "2026-11-05", weekStart: "sat" })).toBeNull();
  });
  it("أيام الدوام تتبع بداية الأسبوع، والتسلسل ذهابًا وإيابًا", () => {
    expect(workdays("sat")).toEqual([0, 1, 2, 3, 4]);
    expect(workdays("mon")).toEqual([1, 2, 3, 4, 5]);
    for (const r of [{ kind: "daily" as const }, { kind: "weekly" as const, byday: [0, 2] }, { kind: "weekdays" as const }, { kind: "every_n_days" as const, n: 3 }, { kind: "monthly_day" as const, day: 5 }]) expect(parseRRule(serializeRRule(r, "sat"))).toEqual(r);
    expect(nextMatching({ kind: "weekdays" }, "2026-11-06", "sat", false)).toBe("2026-11-08"); // الجمعة ⇒ الأحد
  });
});

describe("مستويات الأدوات (ب.2، ب.18-5)", () => {
  it("child يبدأ بـ 0 ولا يرى Kanban قبل avg_support ≥ 2 أو المرحلة 3 إلا بتجاوز المربي", () => {
    const base = { ageMode: "child" as const, avgSupport: 0, incentiveStage: 1, override: null, maxUnlocked: 0 };
    expect(plannerTier(base).tier).toBe(0);
    expect(hasTool(plannerTier(base).tier, "kanban")).toBe(false);
    expect(hasTool(plannerTier({ ...base, avgSupport: 1.0 }).tier, "projects")).toBe(true);
    expect(hasTool(plannerTier({ ...base, avgSupport: 1.9 }).tier, "kanban")).toBe(false);
    expect(hasTool(plannerTier({ ...base, avgSupport: 2.0 }).tier, "kanban")).toBe(true);
    expect(hasTool(plannerTier({ ...base, incentiveStage: 3 }).tier, "kanban")).toBe(true);
    expect(hasTool(plannerTier({ ...base, override: 2 }).tier, "kanban")).toBe(true);
  });
  it("البداية: teen = 1، adult = 2؛ ولا إغلاق بعد الانفتاح؛ والانفتاح الجديد يُعلَّم", () => {
    expect(earnedTier({ ageMode: "teen", avgSupport: 0, incentiveStage: 1 })).toBe(planner.tiers.start_by_age_mode.teen);
    expect(earnedTier({ ageMode: "adult", avgSupport: 0, incentiveStage: 1 })).toBe(planner.tiers.start_by_age_mode.adult);
    const r = plannerTier({ ageMode: "child", avgSupport: 1.0, incentiveStage: 1, override: null, maxUnlocked: 0 });
    expect(r).toMatchObject({ tier: 1, justUnlocked: true, newMax: 1 });
    expect(plannerTier({ ageMode: "child", avgSupport: 0, incentiveStage: 1, override: null, maxUnlocked: 1 }).tier).toBe(1);
    expect(toolsForTier(0).size).toBe(planner.tiers.tools["0"].length);
  });
});

const row = (o: Partial<PlannerTaskRow>): PlannerTaskRow => ({ id: o.id ?? Math.random().toString(36).slice(2), profile_id: "p", project_id: null, section_id: null, parent_task_id: null, title: "t", notes: null, priority: "none", due_date: null, due_time: null, estimate_min: null, actual_min: null, status: "open", completed_at: null, cancel_reason: null, recurrence_rrule: null, recur_from: "schedule", important: false, urgent: false, kanban_column: null, postpone_count: 0, postpone_prompted: false, created_via: "manual", created_by: null, auto_rescheduled: false, linked_goal_id: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...o });

describe("العروض", () => {
  it("اليوم/القادم/المتأخر/المنجز؛ الفرعية لا تظهر كأصول؛ الترتيب بالتاريخ ثم الوقت ثم الأولوية", () => {
    const tasks = [
      row({ id: "a", due_date: "2026-11-05", due_time: "15:00" }), row({ id: "b", due_date: "2026-11-05", due_time: "09:00", priority: "low" }),
      row({ id: "c", due_date: "2026-11-05", due_time: "09:00", priority: "high" }), row({ id: "d", due_date: "2026-11-04" }),
      row({ id: "e", due_date: "2026-11-09" }), row({ id: "f", due_date: "2026-11-30" }), row({ id: "g", status: "done", completed_at: "2026-11-05T10:00:00Z" }),
      row({ id: "h", parent_task_id: "a", due_date: "2026-11-05" }), row({ id: "i" }),
    ];
    const g = groupTasks(tasks, "2026-11-05");
    expect(g.today.map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(g.overdue.map((t) => t.id)).toEqual(["d"]);
    expect(g.upcoming.map((t) => t.id)).toEqual(["e"]);
    expect(g.done.map((t) => t.id)).toEqual(["g"]);
    expect(g.list.map((t) => t.id)).toEqual(["d", "c", "b", "a", "e", "f", "i"]);
  });
  it("الفلتر المحفوظ: أولوية + وسم + نطاق", () => {
    const tasks = [row({ id: "a", priority: "high", due_date: "2026-11-05" }), row({ id: "b", priority: "low", due_date: "2026-11-05" }), row({ id: "c", priority: "high", due_date: "2026-12-05" })];
    expect(applyFilter(tasks, { priority: ["high"], to: "2026-11-30" }, new Map()).map((t) => t.id)).toEqual(["a"]);
    expect(applyFilter(tasks, { tag_ids: ["t1"] }, new Map([["b", ["t1"]]])).map((t) => t.id)).toEqual(["b"]);
  });
});
