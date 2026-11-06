/**
 * التكرار (0.4 ب.3): يومي، أسبوعي بأيام محددة، أيام الدوام، كل N أيام، شهري بيوم محدد.
 * يُخزَّن كجزء من RRULE (FREQ/INTERVAL/BYDAY/BYMONTHDAY) مع recur_from (schedule | completion) في عمود منفصل.
 * دوال نقية على تواريخ "YYYY-MM-DD" بلا منطقة زمنية؛ الحدود من config/planner.json.
 */
import { planner, type RecurrenceKind } from "@/shared/config";

export type Recurrence =
  | { kind: "daily" }
  | { kind: "weekly"; byday: number[] }          // 0 = الأحد … 6 = السبت
  | { kind: "weekdays" }
  | { kind: "every_n_days"; n: number }
  | { kind: "monthly_day"; day: number };
export type RecurFrom = "schedule" | "completion";
export type WeekStart = "sat" | "sun" | "mon";

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** أيام الدوام: الأحد–الخميس حين يبدأ الأسبوع السبت أو الأحد (العطلة الجمعة والسبت)، والاثنين–الجمعة حين يبدأ الاثنين. */
export function workdays(weekStart: WeekStart): number[] {
  return weekStart === "mon" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
}

export function serializeRRule(r: Recurrence, weekStart: WeekStart): string {
  switch (r.kind) {
    case "daily": return "FREQ=DAILY";
    case "weekly": return `FREQ=WEEKLY;BYDAY=${[...new Set(r.byday)].sort((a, b) => a - b).map((d) => DAY_CODES[d]).join(",")}`;
    case "weekdays": return `FREQ=WEEKLY;BYDAY=${workdays(weekStart).map((d) => DAY_CODES[d]).join(",")};X-KIND=weekdays`;
    case "every_n_days": return `FREQ=DAILY;INTERVAL=${r.n}`;
    case "monthly_day": return `FREQ=MONTHLY;BYMONTHDAY=${r.day}`;
  }
}

export function parseRRule(s: string | null | undefined): Recurrence | null {
  if (!s) return null;
  const parts = Object.fromEntries(s.split(";").map((p) => p.split("=") as [string, string]));
  const freq = parts.FREQ;
  if (freq === "DAILY") {
    const n = Number(parts.INTERVAL ?? 1);
    if (!Number.isInteger(n) || n < 1) return null;
    return n === 1 ? { kind: "daily" } : { kind: "every_n_days", n };
  }
  if (freq === "WEEKLY") {
    if (parts["X-KIND"] === "weekdays") return { kind: "weekdays" };
    const byday = (parts.BYDAY ?? "").split(",").map((c) => DAY_CODES.indexOf(c)).filter((d) => d >= 0);
    return byday.length ? { kind: "weekly", byday } : null;
  }
  if (freq === "MONTHLY") {
    const day = Number(parts.BYMONTHDAY);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? { kind: "monthly_day", day } : null;
  }
  return null;
}

export function isAllowedRecurrence(r: Recurrence): boolean {
  const c = planner.tasks.recurrence;
  if (!c.kinds.includes(r.kind as RecurrenceKind)) return false;
  if (r.kind === "every_n_days" && (r.n < 1 || r.n > c.every_n_days_max)) return false;
  return true;
}

/** الافتراضي: «كل N أيام» من الإنجاز، والبقية من الجدول (config). */
export function defaultRecurFrom(r: Recurrence): RecurFrom {
  const d = planner.tasks.recurrence.default_recur_from;
  return r.kind === "every_n_days" ? d.every_n_days : d.default;
}

// --- أدوات التاريخ (UTC داخليًا؛ التواريخ بلا منطقة) ---
export function toUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
export function fmtDate(d: Date): string { return d.toISOString().slice(0, 10); }
export function addDays(date: string, n: number): string { const d = toUtc(date); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); }
export function weekdayOf(date: string): number { return toUtc(date).getUTCDay(); }
export function daysBetween(a: string, b: string): number { return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86400000); }

/** أول تاريخ ≥ from يطابق القاعدة (أو > from عند strictlyAfter). */
export function nextMatching(r: Recurrence, from: string, weekStart: WeekStart, strictlyAfter: boolean): string {
  let d = strictlyAfter ? addDays(from, 1) : from;
  if (r.kind === "daily") return d;
  if (r.kind === "every_n_days") return strictlyAfter ? addDays(from, r.n) : from;
  const days = r.kind === "weekly" ? new Set(r.byday) : r.kind === "weekdays" ? new Set(workdays(weekStart)) : null;
  for (let i = 0; i < 62; i++) {
    if (days) { if (days.has(weekdayOf(d))) return d; }
    else if (r.kind === "monthly_day") {
      const u = toUtc(d);
      if (u.getUTCDate() === r.day) return d;
      // اقفز إلى يوم الشهر المطلوب في هذا الشهر أو التالي (الشهر القصير يُقصّ إلى آخر يوم)
      const target = new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth() + (u.getUTCDate() > r.day ? 1 : 0), 1));
      const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      return fmtDate(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(r.day, last))));
    }
    d = addDays(d, 1);
  }
  return d;
}

export type NextOccurrenceInput = { rrule: string | null; recurFrom: RecurFrom; dueDate: string | null; completedOn: string; weekStart: WeekStart };

/**
 * التاريخ التالي بعد الإنجاز: من الجدول = أول تكرار بعد الاستحقاق (ويُقفز فوق ما فات إن أُنجز متأخرًا كثيرًا حتى لا يتراكم)؛
 * من الإنجاز = أول تكرار بعد يوم الإنجاز (مثال ب.18-2: «كل 3 أيام» أُنجزت متأخرة يومين ⇒ بعد 3 أيام من الإنجاز).
 */
export function nextOccurrence(i: NextOccurrenceInput): string | null {
  const r = parseRRule(i.rrule);
  if (!r) return null;
  if (i.recurFrom === "completion" || !i.dueDate) return nextMatching(r, i.completedOn, i.weekStart, true);
  let next = nextMatching(r, i.dueDate, i.weekStart, true);
  // الجدول: لا نُنشئ تكرارات في الماضي؛ نقفز إلى أول تكرار بعد يوم الإنجاز أو الاستحقاق أيهما أبعد
  while (next <= i.completedOn && next < i.dueDate) next = nextMatching(r, next, i.weekStart, true);
  if (next <= i.completedOn) next = nextMatching(r, i.completedOn, i.weekStart, true);
  return next;
}
