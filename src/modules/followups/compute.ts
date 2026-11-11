/**
 * الحين والتالي (0.4 د) — قواعد نقية: ما انتهى وقته، شكل العرض (أوراق أو قائمة)، بطاقة التالي، والانتقال.
 * كل القيم من config/planner.json.followup والإعدادات الفعّالة تُمرَّر كمعاملات.
 */
import { planner } from "@/shared/config";
import { instantForLocal } from "@/modules/notifications/plan";

const cfg = planner.followup as unknown as {
  items: string[]; replies: string[]; missed_followups: string[]; max_cards_sequential: number; batch_list_above: number; snooze_max_per_item: number; after_snooze_max: string;
  duration_feel_question: { options: string[]; max_per_day: number; evidence: boolean }; sync_close_all_devices: boolean;
  next: { fade: { capability: string; L0_L1: string; L2_L3: string }; rest_option: boolean; rest_suppress_next_minutes: number; all_priorities_done: string; after_quiet_hours: string };
  upcoming_card: boolean; evidence: { F1: { type: string; capability: string; source: string; rule_weight: number; min_support_level: string; value: number; negative: boolean }; rest_chosen: string };
};
export const followupConfig = cfg;

export type ItemKind = "task" | "block" | "habit" | "mission";
export type ScheduledItem = { kind: ItemKind; id: string; title: string; startsAt: Date; endsAt: Date; occurrenceDate: string; taskId?: string | null };

export type BuildInput = {
  date: string; tz: string; defaultDurationMin: number;
  tasks: Array<{ id: string; title: string; due_date: string | null; due_time: string | null; estimate_min: number | null; status: string; margin_min?: number | null; margin_extra_min?: number | null }>;
  blocks: Array<{ id: string; task_id: string | null; starts_at: string; ends_at: string; title: string }>;
  habits: Array<{ id: string; title: string; schedule: { time_local?: string | null; duration_min?: number | null }; scheduledToday: boolean }>;
};

/** جدول اليوم المحلي: مهام بوقت، كتل، عادات بوقت (د.2). */
export function buildScheduled(i: BuildInput): ScheduledItem[] {
  const out: ScheduledItem[] = [];
  for (const t of i.tasks) {
    if (t.status !== "open" || t.due_date !== i.date || !t.due_time) continue;
    const start = instantForLocal(i.date, t.due_time.slice(0, 5), i.tz);
    out.push({ kind: "task", id: t.id, title: t.title, startsAt: start, endsAt: new Date(start.getTime() + (t.margin_min ? t.margin_min + (t.margin_extra_min ?? 0) : t.estimate_min ?? i.defaultDurationMin) * 60000), occurrenceDate: i.date, taskId: t.id });
  }
  for (const b of i.blocks) out.push({ kind: "block", id: b.id, title: b.title, startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at), occurrenceDate: i.date, taskId: b.task_id });
  for (const h of i.habits) {
    if (!h.scheduledToday || !h.schedule.time_local) continue;
    const start = instantForLocal(i.date, h.schedule.time_local, i.tz);
    out.push({ kind: "habit", id: h.id, title: h.title, startsAt: start, endsAt: new Date(start.getTime() + (h.schedule.duration_min ?? i.defaultDurationMin) * 60000), occurrenceDate: i.date });
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** ما انتهى وقته خلال نافذة النظر للخلف ولم يُسجَّل (د.2). الأقدم من النافذة يذهب للمتأخر العادي. */
export function endedItems(items: ScheduledItem[], now: Date, o: { graceMin: number; lookbackHours: number }): ScheduledItem[] {
  const lookback = now.getTime() - o.lookbackHours * 3600000;
  return items.filter((it) => it.endsAt.getTime() + o.graceMin * 60000 <= now.getTime() && it.endsAt.getTime() >= lookback);
}

/** أكثر من 3 ⇒ قائمة واحدة بخانات اختيار (د.3). */
export function presentation(count: number): "sheets" | "list" | "none" {
  if (count <= 0) return "none";
  return count > cfg.batch_list_above ? "list" : "sheets";
}

/** «بعدين» مرتين كحد أقصى ثم يذهب للمتأخر بهدوء (د.3). */
export function snoozeAllowed(snoozeCount: number): boolean { return snoozeCount < cfg.snooze_max_per_item; }

export type NextInput = {
  now: Date; items: ScheduledItem[]; remainingPriorities: Array<{ id: string | null; text: string }>; prioritiesTotal: number;
  freeGapMin: number; upcomingSoonMin: number; quietNow: boolean; windDownNow: boolean; restSuppressedUntil: Date | null; supportBand: "L0_L1" | "L2_L3";
};
export type NextCard =
  | { kind: "now"; item: ScheduledItem; untilLabel: Date }
  | { kind: "next"; item: ScheduledItem; minutesUntil: number }
  | { kind: "free_gap"; untilAt: Date | null; topPriority: { id: string | null; text: string } | null }
  | { kind: "priority"; priority: { id: string | null; text: string } }
  | { kind: "all_done" } | { kind: "quiet" } | { kind: "wind_down" } | { kind: "rest" } | { kind: "nothing" };
export type NextDecision = { mode: "suggest" | "ask"; card: NextCard; askOptions: Array<{ id: string; label: string; kind: "task" | "block" | "habit" | "priority" | "rest" }> };

/** بطاقة التالي (د.4): الحالة الحالية، التالي القريب، فراغ، أولوية باقية، كل شيء أُنجز، الهدوء، التهدئة. عند L2+ تسأل بخيارات. */
export function nextCard(i: NextInput): NextDecision {
  const t = i.now.getTime();
  let card: NextCard;
  if (i.quietNow) card = { kind: "quiet" };
  else if (i.windDownNow) card = { kind: "wind_down" };
  else if (i.restSuppressedUntil && i.restSuppressedUntil.getTime() > t) card = { kind: "rest" };
  else {
    const current = i.items.find((x) => x.startsAt.getTime() <= t && x.endsAt.getTime() > t);
    const upcoming = i.items.filter((x) => x.startsAt.getTime() > t).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;
    const top = i.remainingPriorities[0] ?? null;
    if (current) card = { kind: "now", item: current, untilLabel: current.endsAt };
    else if (upcoming && (upcoming.startsAt.getTime() - t) / 60000 <= i.freeGapMin) card = { kind: "next", item: upcoming, minutesUntil: Math.round((upcoming.startsAt.getTime() - t) / 60000) };
    else if (upcoming) card = { kind: "free_gap", untilAt: upcoming.startsAt, topPriority: top };
    else if (top) card = { kind: "priority", priority: top };
    else if (i.prioritiesTotal > 0) card = { kind: "all_done" };
    else card = { kind: "nothing" };
  }
  const askable = card.kind === "now" || card.kind === "next" || card.kind === "free_gap" || card.kind === "priority";
  const mode: "suggest" | "ask" = i.supportBand === "L2_L3" && askable ? "ask" : "suggest";
  const options: NextDecision["askOptions"] = [];
  if (mode === "ask") {
    for (const it of i.items.filter((x) => x.endsAt.getTime() > t).slice(0, 2)) options.push({ id: it.id, label: it.title, kind: it.kind === "mission" ? "task" : it.kind });
    for (const p of i.remainingPriorities.slice(0, 2)) if (!options.some((o) => o.id === p.id)) options.push({ id: p.id ?? `p:${p.text}`, label: p.text, kind: "priority" });
    if (cfg.next.rest_option) options.push({ id: "rest", label: "rest", kind: "rest" });
  }
  return { mode, card, askOptions: options };
}

/** الانتقال (د.7): بدأ التالي خلال transition_minutes من آخر «تمّت». */
export function transitionStarted(lastDoneAt: Date, startedAt: Date, transitionMin: number): boolean {
  const d = (startedAt.getTime() - lastDoneAt.getTime()) / 60000;
  return d >= 0 && d <= transitionMin;
}

/** «بعد 30 دقيقة: رياضة» (د.5). */
export function upcomingSoon(items: ScheduledItem[], now: Date, soonMin: number): ScheduledItem | null {
  const t = now.getTime();
  return items.find((x) => x.startsAt.getTime() > t && (x.startsAt.getTime() - t) / 60000 <= soonMin) ?? null;
}
