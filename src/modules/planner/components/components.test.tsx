/** واجهة المخطط: المعاينة قبل الحفظ (ب.18-1)، سؤال التأجيل (ب.18-4)، تسميات التكرار والتذكير. */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { QuickAdd } from "./quick-add";
import { TaskList, PostponePrompt } from "./task-list";
import { recurrenceLabel, reminderOffsetLabel } from "../labels";
import content from "@content/planner.ar.json";
import type { PlannerTaskRow } from "../types";

const ctx = { today: "2026-11-05", ambiguousPmUntil: 7, weekStart: "sat" as const };
const row = (o: Partial<PlannerTaskRow>): PlannerTaskRow => ({ id: "00000000-0000-4000-8000-000000000001", profile_id: "p", project_id: null, section_id: null, parent_task_id: null, title: "اجتماع", notes: null, priority: "high", due_date: "2026-11-06", due_time: "17:00:00", estimate_min: null, actual_min: null, status: "open", completed_at: null, cancel_reason: null, recurrence_rrule: null, recur_from: "schedule", important: false, urgent: false, kanban_column: null, postpone_count: 0, postpone_prompted: false, created_via: "nlp", created_by: null, auto_rescheduled: false, linked_goal_id: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...o });

describe("P33 الإدخال السريع", () => {
  it("لا يحفظ صامتًا: زر المعاينة أولًا، ولا تظهر حقول المعاينة قبل التحليل", () => {
    const html = renderToString(<QuickAdd ctx={ctx} canUseTier1 />);
    expect(html).toContain(content.quick_add.preview_title);
    expect(html).not.toContain('data-testid="quick-add-preview"');
    expect(html).toContain(content.quick_add.placeholder);
  });
});

describe("P24 القائمة وسؤال التأجيل", () => {
  it("تعرض المهمة بالأولوية والموعد وأزرار التأجيل بلا أي خصم", () => {
    const html = renderToString(<TaskList tasks={[row({ postpone_count: 2 })]} today="2026-11-05" emptyText="فارغ" />);
    expect(html).toContain("اجتماع");
    expect(html).toContain(content.priority.high);
    expect(html).toContain(content.task.postpone_tomorrow);
    expect(html).toContain(content.task.postponed_times.replace("{n}", "2"));
    expect(html).not.toMatch(/خصم|عقوبة/);
  });
  it("سؤال التأجيل بخياراته الأربعة + «غير ذلك» الذي تضيفه الواجهة", () => {
    const html = renderToString(<PostponePrompt taskId="00000000-0000-4000-8000-000000000001" onDone={() => {}} />);
    expect(html).toContain(content.postpone_prompt.question);
    for (const o of Object.values(content.postpone_prompt.options)) expect(html).toContain(o);
    expect(html).toContain(content.postpone_prompt.other);
  });
  it("القائمة الفارغة تعرض نص العرض", () => {
    expect(renderToString(<TaskList tasks={[]} today="2026-11-05" emptyText={content.empty.today} />)).toContain(content.empty.today);
  });
});

describe("التسميات", () => {
  it("التكرار والتذكير من المحتوى", () => {
    expect(recurrenceLabel({ kind: "weekly", byday: [0, 2] })).toContain(content.weekdays[0]);
    expect(recurrenceLabel({ kind: "every_n_days", n: 3 }, "completion")).toContain(content.recurrence.from_completion);
    expect(reminderOffsetLabel(0)).toBe(content.reminder.at_due);
    expect(reminderOffsetLabel(60)).toBe(content.reminder.before_hours.replace("{h}", "1"));
    expect(reminderOffsetLabel(1440)).toBe(content.reminder.before_days.replace("{d}", "1"));
    expect(reminderOffsetLabel(10)).toBe(content.reminder.before.replace("{min}", "10"));
  });
});
