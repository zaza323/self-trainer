/**
 * قواعد الإشعارات الخالصة (NOTIF-1، NOTIF-4، NOTIF-5): الوقت المحلي بالمنطقة الزمنية، ساعات الهدوء، الحد اليومي، التأجيل.
 * لا أرقام هنا: الحدود من config/limits.json والإعدادات من settings.effective.
 */
export type TimeRange = [string, string]; // ["22:00", "07:00"] قد تلتف حول منتصف الليل

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }); fmtCache.set(tz, f); }
  return f;
}
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type LocalParts = { date: string; minutes: number; weekday: number; hhmm: string };
/** الأجزاء المحلية للحظة في منطقة زمنية. يسقط إلى UTC إن كانت المنطقة غير معروفة. */
export function localParts(instant: Date, tz: string): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = fmt(tz).formatToParts(instant); } catch { parts = fmt("UTC").formatToParts(instant); }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hh = Number(get("hour")) % 24, mm = Number(get("minute"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: hh * 60 + mm, weekday: WEEKDAYS.indexOf(get("weekday")), hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

export function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** اللحظة (UTC) التي يكون فيها التوقيت المحلي في المنطقة tz = date HH:MM. */
export function instantForLocal(date: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, Math.floor(parseHHMM(hhmm) / 60), parseHHMM(hhmm) % 60);
  // تصحيح بفارق المنطقة (مرتان لحواف التوقيت الصيفي)
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const lp = localParts(new Date(t), tz);
    const localAsUtc = Date.UTC(Number(lp.date.slice(0, 4)), Number(lp.date.slice(5, 7)) - 1, Number(lp.date.slice(8, 10)), Math.floor(lp.minutes / 60), lp.minutes % 60);
    t += guess - localAsUtc;
  }
  return new Date(t);
}

export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d! + n)).toISOString().slice(0, 10);
}

/** هل الدقيقة المحلية داخل ساعات الهدوء؟ (المدى قد يلتف حول منتصف الليل؛ مدى فارغ أو متساوٍ = لا هدوء) */
export function inQuietHours(minutes: number, range: TimeRange | null | undefined): boolean {
  if (!range || !range[0] || !range[1]) return false;
  const from = parseHHMM(range[0]), to = parseHHMM(range[1]);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** أول لحظة بعد `instant` تخرج فيها من ساعات الهدوء. */
export function quietEnd(instant: Date, tz: string, range: TimeRange): Date {
  const lp = localParts(instant, tz);
  const to = parseHHMM(range[1]);
  const sameDay = instantForLocal(lp.date, range[1], tz);
  return lp.minutes < to ? sameDay : instantForLocal(addDays(lp.date, 1), range[1], tz);
}

/** الفتحة اليومية القادمة لوقت الإشعار المختار: اليوم إن لم يمض، وإلا غدًا. */
export function nextDailySlot(now: Date, tz: string, notificationTime: string): Date {
  const lp = localParts(now, tz);
  const today = instantForLocal(lp.date, notificationTime, tz);
  return today.getTime() > now.getTime() ? today : instantForLocal(addDays(lp.date, 1), notificationTime, tz);
}

export type DeliveryInput = {
  now: Date;
  tz: string;
  bypass: boolean;                 // NOTIF-5: الأمان خارج الحد والهدوء
  sentTodayCount: number;          // ما أُرسل للمستلم في يومه المحلي (الأنواع الخاضعة للحد)
  maxPerDay: number;               // notification_max_per_day الفعّال (مقصوص بالحد الصلب)
  hardCap: number;                 // limits.notifications.hard_cap_per_day
  quiet: TimeRange | null;
  notificationTime: string;        // "HH:MM"
};
export type DeliveryDecision = { action: "send" } | { action: "defer"; until: Date; reason: "quiet" | "cap" } | { action: "drop"; reason: "cap_zero" };

/** قرار التسليم الآن أو التأجيل (NOTIF-1، NOTIF-5). */
export function decideDelivery(i: DeliveryInput): DeliveryDecision {
  if (i.bypass) return { action: "send" };
  const max = Math.min(i.maxPerDay, i.hardCap);
  if (max <= 0) return { action: "drop", reason: "cap_zero" };
  const lp = localParts(i.now, i.tz);
  if (i.quiet && inQuietHours(lp.minutes, i.quiet)) return { action: "defer", until: quietEnd(i.now, i.tz, i.quiet), reason: "quiet" };
  if (i.sentTodayCount >= max) {
    // غدًا في وقت الإشعار (أو بعد نهاية الهدوء إن تداخل)
    let until = instantForLocal(addDays(lp.date, 1), i.notificationTime, i.tz);
    if (i.quiet && inQuietHours(localParts(until, i.tz).minutes, i.quiet)) until = quietEnd(until, i.tz, i.quiet);
    return { action: "defer", until, reason: "cap" };
  }
  return { action: "send" };
}


/**
 * notification_max_per_day = "auto" (0.4): السقف اليومي تحدده حالة التفاعل (الجزء و، الخطوة 3).
 * إلى أن تُبنى حالات التفاعل، "auto" = أدنى ميزانية غير صفرية (planner.engagement.budget.low) فيبقى سلوك 0.3 كما هو.
 */
export function resolveMaxPerDay(setting: number | "auto", autoBudget: number, hardCap: number): number {
  return Math.min(setting === "auto" ? autoBudget : setting, hardCap);
}
