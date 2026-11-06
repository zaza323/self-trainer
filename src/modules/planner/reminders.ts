/** التذكيرات (0.4 ب.5) — دوال نقية: متى يُطلق التذكير، والتأجيل (Snooze) من خيارات config. */
import { planner } from "@/shared/config";
import { instantForLocal, addDays, localParts } from "@/modules/notifications/plan";

export type ReminderSpec = { kind: "absolute"; at: string; important?: boolean } | { kind: "relative"; offset_min: number; important?: boolean };

/** لحظة الإطلاق: المطلق كما هو؛ النسبي = موعد المهمة (تاريخ + وقت أو بداية اليوم) ناقص offset. */
export function reminderFireAt(spec: ReminderSpec, task: { due_date: string | null; due_time: string | null }, tz: string): Date | null {
  if (spec.kind === "absolute") { const d = new Date(spec.at); return Number.isNaN(d.getTime()) ? null : d; }
  if (!task.due_date) return null;
  const due = instantForLocal(task.due_date, (task.due_time ?? "00:00").slice(0, 5), tz);
  return new Date(due.getTime() - spec.offset_min * 60000);
}

export type SnoozeOption = (typeof planner.reminders.snooze_options)[number];

export function snoozeUntil(option: SnoozeOption, now: Date, tz: string): Date {
  if ("minutes" in option) return new Date(now.getTime() + option.minutes * 60000);
  return instantForLocal(addDays(localParts(now, tz).date, 1), option.tomorrow_at, tz);
}

export function snoozeOptions(): SnoozeOption[] { return planner.reminders.snooze_options; }
export function relativePresets(): number[] { return planner.reminders.relative_presets_min; }
