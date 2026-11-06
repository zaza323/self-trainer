/**
 * المحلّل الحتمي للإدخال السريع (0.4 ب.4): عربي فصيح + شامي/أردني + إنجليزي. يعمل أولًا دائمًا؛
 * task_parser بالذكاء الاصطناعي احتياطي فقط حين تكون الثقة < planner.nlp.ai_fallback_below_confidence (المرحلة 11).
 * يفهم: التواريخ، الأوقات، التكرار، الوسوم #، المشروع /، الأولوية !، التذكير، المدة. الساعة الغامضة 1..N تُفهم مساءً.
 * دالة نقية: لا منطقة زمنية هنا؛ «اليوم» يُمرَّر محسوبًا بمنطقة المستخدم.
 */
import { planner, type PlannerPriority } from "@/shared/config";
import { addDays, defaultRecurFrom, weekdayOf, nextMatching, type Recurrence, type RecurFrom, type WeekStart } from "./recurrence";

export type ParsedTask = {
  title: string;
  due_date: string | null;
  due_time: string | null;                       // HH:MM
  recurrence: Recurrence | null;
  recur_from: RecurFrom | null;
  tags: string[];
  project: string | null;
  priority: PlannerPriority;
  reminder: { offset_min: number } | null;       // offset 0 = عند الموعد
  estimate_min: number | null;
  confidence: number;                            // 0..1
  /** ما تعرّف عليه المحلّل (للمعاينة والاختبار) */
  matched: string[];
};

export type ParseContext = {
  today: string;                 // YYYY-MM-DD بمنطقة المستخدم
  ambiguousPmUntil: number;      // إعداد ambiguous_hour_pm_until
  weekStart: WeekStart;
};

const cfg = planner.nlp;

/** تطبيع للمطابقة فقط: إزالة التشكيل، توحيد الألف والتاء المربوطة والياء، الأرقام الهندية إلى عربية. */
export function normalizeAr(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ").trim();
}

// لا حدود كلمات (\b) مع العربية في JS؛ الكلمة تُمرَّر معزولة ومطبَّعة
const WEEKDAY_WORDS: Array<[RegExp, number]> = [
  [/^(?:(?:ال)?(?:احد)|sun(?:day)?)$/, 0],
  [/^(?:(?:ال)?(?:اثنين|تنين)|mon(?:day)?)$/, 1],
  [/^(?:(?:ال)?(?:ثلاثاء|ثلاثا|تلاتا|ثلثاء)|tue(?:s|sday)?)$/, 2],
  [/^(?:(?:ال)?(?:اربعاء|اربعا|اربعه)|wed(?:nesday)?)$/, 3],
  [/^(?:(?:ال)?(?:خميس)|thu(?:rs|rsday)?)$/, 4],
  [/^(?:(?:ال)?(?:جمعه)|fri(?:day)?)$/, 5],
  [/^(?:(?:ال)?(?:سبت)|sat(?:urday)?)$/, 6],
];
const WEEKDAY_ANY = /(?:ال)?(?:احد|أحد|اثنين|إثنين|تنين|ثلاثاء|ثلاثا|تلاتا|ثلثاء|اربعاء|اربعا|أربعاء|اربعه|خميس|جمعه|جمعة|سبت)|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?/;

function weekdayIndex(word: string): number | null {
  const w = normalizeAr(word).toLowerCase();
  for (const [re, idx] of WEEKDAY_WORDS) if (re.test(w)) return idx;
  return null;
}

type Period = "am" | "pm";
const PERIOD_WORDS: Array<[RegExp, Period, keyof typeof cfg.period_hours | null]> = [
  [/^(?:الصبح|صبحا|صباحا|الصباح|صباح|ص|am|morning)$/, "am", "morning"],
  [/^(?:الظهر|ظهرا|ظهر|noon)$/, "pm", "noon"],
  [/^(?:العصر|عصرا|عصر|afternoon)$/, "pm", "afternoon"],
  [/^(?:المسا|مسا|مساء|المساء|م|pm|evening)$/, "pm", "evening"],
  [/^(?:الليل|ليلا|بالليل|night|tonight)$/, "pm", "night"],
];
function periodOf(word: string | undefined): [Period, keyof typeof cfg.period_hours | null] | null {
  if (!word) return null;
  const w = normalizeAr(word).toLowerCase();
  for (const [re, p, key] of PERIOD_WORDS) if (re.test(w)) return [p, key];
  return null;
}

function hhmm(h: number, m = 0): string { return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }

/** الساعة الغامضة (بلا صباح/مساء): 1..pm_until ⇒ مساءً. */
export function resolveHour(h: number, period: Period | null, pmUntil: number): number | null {
  if (h < 0 || h > 23) return null;
  if (period === "am") return h === 12 ? 0 : h;
  if (period === "pm") return h < 12 ? h + 12 : h;
  if (h >= 1 && h <= pmUntil) return h + 12;
  return h;
}

const PRIORITY_RE = new RegExp(`(?:^|\\s)\\${cfg.priority_prefix}(\\S+)`, "g");
const TAG_RE = new RegExp(`(?:^|\\s)\\${cfg.tag_prefix}([^\\s${cfg.tag_prefix}${cfg.project_prefix}]+)`, "g");
const PROJECT_RE = new RegExp(`(?:^|\\s)\\${cfg.project_prefix}([^\\s${cfg.tag_prefix}${cfg.project_prefix}]+)`);
const DATE_NUM_RE = /(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/;
const MIN_WORDS = "(?:دقيقه|دقيقة|دقايق|دقائق|د|min|mins|minutes?)";
const HOUR_WORDS = "(?:ساعه|ساعة|ساعات|h|hr|hrs|hours?)";
const DAY_WORDS = "(?:يوم|ايام|أيام|days?)";

function unitToMin(n: number, unit: string): number {
  const u = normalizeAr(unit).toLowerCase();
  if (new RegExp(`^${HOUR_WORDS}$`).test(u)) return n * 60;
  if (new RegExp(`^${DAY_WORDS}$`).test(u)) return n * 1440;
  return n;
}

function priorityFromToken(tok: string): PlannerPriority | null {
  const t = normalizeAr(tok);
  for (const p of ["high", "medium", "low"] as const) if (cfg.priority_tokens[p].some((x) => normalizeAr(x) === t)) return p;
  if (/^(high|h)$/i.test(tok)) return "high";
  if (/^(medium|med|m)$/i.test(tok)) return "medium";
  if (/^(low|l)$/i.test(tok)) return "low";
  return null;
}

/** يزيل مطابقة ويعيد ما قبلها وما بعدها بمسافة واحدة. */
function cut(s: string, m: RegExpMatchArray): string {
  const start = m.index!, end = start + m[0].length;
  return (s.slice(0, start) + " " + s.slice(end)).replace(/\s+/g, " ").trim();
}

export function parseQuickAdd(raw: string, ctx: ParseContext): ParsedTask {
  let s = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, " ").trim();
  const matched: string[] = [];
  const out: ParsedTask = { title: "", due_date: null, due_time: null, recurrence: null, recur_from: null, tags: [], project: null, priority: "none", reminder: null, estimate_min: null, confidence: 0, matched };
  let hour: number | null = null, minute = 0, period: Period | null = null;
  let m: RegExpMatchArray | null;

  // 1) الأولوية !عالية / !1
  for (const mm of [...s.matchAll(PRIORITY_RE)]) {
    const p = priorityFromToken(mm[1]!);
    if (p) { out.priority = p; matched.push("priority"); s = cut(s, mm); break; }
  }
  // 2) التاريخ الرقمي 5/11 قبل المشروع /x
  if ((m = s.match(DATE_NUM_RE))) {
    const d = Number(m[1]), mo = Number(m[2]);
    let y = Number(ctx.today.slice(0, 4));
    if (m[3]) y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!m[3] && date < ctx.today) date = `${y + 1}-${date.slice(5)}`;
      out.due_date = date; matched.push("date"); s = cut(s, m);
    }
  }
  // 3) الوسوم والمشروع
  for (const mm of [...s.matchAll(TAG_RE)]) out.tags.push(mm[1]!);
  if (out.tags.length) { matched.push("tags"); s = s.replace(TAG_RE, " ").replace(/\s+/g, " ").trim(); }
  if ((m = s.match(PROJECT_RE))) { out.project = m[1]!; matched.push("project"); s = cut(s, m); }

  // 4) المدة: لمدة 45 دقيقة / for 30 min
  if ((m = s.match(new RegExp(`(?:لمده|لمدة|مدتها|مده|مدة|for)\\s*(\\d+)\\s*(${MIN_WORDS}|${HOUR_WORDS})(?=\\s|$)`, "i")))) {
    out.estimate_min = unitToMin(Number(m[1]), m[2]!); matched.push("estimate"); s = cut(s, m);
  } else if ((m = s.match(new RegExp(`(?:^|\\s)(\\d+)\\s*(${MIN_WORDS})(?=\\s|$)`)))) {
    out.estimate_min = Number(m[1]); matched.push("estimate"); s = cut(s, m);
  }

  // 5) التذكير: ذكرني … قبل بساعة / قبل 10 دقايق
  let reminderWord = false;
  if ((m = s.match(/(?:^|\s)(?:ذكرني|ذكّرني|ذكريني|فكرني|remind me|remind)(?=\s|$)/i))) { reminderWord = true; s = cut(s, m); }
  if ((m = s.match(new RegExp(`(?:قبل(?:ها)?(?:\\s*ب)?\\s*)(?:(\\d+)\\s*)?(ساعتين|نص ساعه|نص ساعة|نصف ساعة|${MIN_WORDS}|${HOUR_WORDS}|${DAY_WORDS})(?=\\s|$)`, "i")))
    || (m = s.match(new RegExp(`(\\d+)\\s*(${MIN_WORDS}|${HOUR_WORDS}|${DAY_WORDS})\\s*(?:before|early)(?=\\s|$)`, "i")))) {
    const unit = normalizeAr(m[2]!);
    let n = m[1] ? Number(m[1]) : 1;
    let offset: number;
    if (/^ساعتين$/.test(unit)) offset = 120;
    else if (/^نص/.test(unit)) offset = 30;
    else { if (!m[1] && new RegExp(`^${MIN_WORDS}$`).test(unit)) n = 1; offset = unitToMin(n, m[2]!); }
    out.reminder = { offset_min: offset }; matched.push("reminder"); s = cut(s, m);
  } else if (reminderWord) { out.reminder = { offset_min: 0 }; matched.push("reminder"); }

  // 6) التكرار: كل يوم / كل أحد وثلاثاء / كل 3 أيام / يوميًا / كل أسبوع / كل شهر / أيام الدوام
  const norm = (x: string) => normalizeAr(x).toLowerCase();
  if ((m = s.match(/(?:^|\s)(?:كل|every)\s+(\d+)\s*(?:ايام|أيام|يوم|days?)(?=\s|$)/i))) {
    out.recurrence = { kind: "every_n_days", n: Number(m[1]) }; matched.push("recurrence"); s = cut(s, m);
  } else if ((m = s.match(/(?:^|\s)(?:كل يوم دوام|ايام الدوام|أيام الدوام|every weekday|weekdays)(?=\s|$)/i))) {
    out.recurrence = { kind: "weekdays" }; matched.push("recurrence"); s = cut(s, m);
  } else if ((m = s.match(/(?:^|\s)(?:كل يوم|يوميا|يوميًا|يومياً|daily|every day|everyday)(?=\s|$)/i))) {
    out.recurrence = { kind: "daily" }; matched.push("recurrence"); s = cut(s, m);
  } else if ((m = s.match(new RegExp(`(?:^|\\s)(?:كل|every)\\s+((?:${WEEKDAY_ANY.source})(?:\\s*(?:و|,|and)\\s*(?:${WEEKDAY_ANY.source}))*)(?=\\s|$)`, "i")))) {
    const days = m[1]!.split(/\s*(?:\sو|و|,|and)\s*/).map((w) => w.trim()).filter(Boolean);
    const byday = [...new Set(days.map(weekdayIndex).filter((d): d is number => d !== null))];
    if (byday.length) { out.recurrence = { kind: "weekly", byday }; matched.push("recurrence"); s = cut(s, m); }
  } else if ((m = s.match(/(?:^|\s)(?:كل اسبوع|كل أسبوع|اسبوعيا|أسبوعيًا|اسبوعيًا|weekly|every week)(?=\s|$)/i))) {
    out.recurrence = { kind: "weekly", byday: [] }; matched.push("recurrence"); s = cut(s, m);   // اليوم يُحدَّد من التاريخ لاحقًا
  } else if ((m = s.match(/(?:^|\s)(?:كل شهر|شهريا|شهريًا|monthly|every month)(?=\s|$)/i))) {
    out.recurrence = { kind: "monthly_day", day: 0 }; matched.push("recurrence"); s = cut(s, m);   // اليوم من التاريخ لاحقًا
  }

  // 7) الوقت: الساعة 5 / 17:00 / 5 المسا / 7 الصبح / الصبح
  const periodAlt = "الصبح|صبحا|صباحا|الصباح|صباح|الظهر|ظهرا|العصر|عصرا|المسا|مسا|مساء|المساء|الليل|ليلا|بالليل|am|pm|morning|noon|afternoon|evening|night|tonight";
  if ((m = s.match(/(?:^|\s)(\d{1,2}):(\d{2})\s*(ص|م|am|pm)?(?=\s|$)/i))) {
    hour = Number(m[1]); minute = Number(m[2]); const p = periodOf(m[3]); if (p) period = p[0]; matched.push("time"); s = cut(s, m);
  } else if ((m = s.match(new RegExp(`(?:^|\\s)(?:الساعه|الساعة|الساعه|at|@)\\s*(\\d{1,2})(?:\\s*(?:و\\s*)?(?:نص|نصف|half))?\\s*(${periodAlt}|ص|م)?(?=\\s|$)`, "i")))) {
    hour = Number(m[1]); minute = /نص|نصف|half/.test(m[0]) ? 30 : 0; const p = periodOf(m[2]); if (p) period = p[0]; matched.push("time"); s = cut(s, m);
  } else if ((m = s.match(new RegExp(`(?:^|\\s)(\\d{1,2})\\s*(${periodAlt}|ص|م)(?=\\s|$)`, "i")))) {
    hour = Number(m[1]); const p = periodOf(m[2]); if (p) period = p[0]; matched.push("time"); s = cut(s, m);
  }

  // 8) التاريخ: اليوم / بكرا / بعد بكرا / بعد 3 أيام / الأحد (الجاي) ؛ ورقم تالٍ للتاريخ هو ساعة غامضة («بكرا 3»)
  const takeTrailingHour = (mm: RegExpMatchArray) => { if (mm[1] && hour === null) { hour = Number(mm[1]); matched.push("time"); } };
  if ((m = s.match(/(?:^|\s)(?:بعد بكرا|بعد بكره|بعد غد|بعد غدا|بعد غدًا|day after tomorrow)(?:\s+(\d{1,2}))?(?=\s|$)/i))) {
    out.due_date = addDays(ctx.today, 2); matched.push("date"); takeTrailingHour(m); s = cut(s, m);
  } else if ((m = s.match(/(?:^|\s)(?:بكرا|بكره|بكرة|غدا|غدًا|غداً|tomorrow|tmrw)(?:\s+(\d{1,2}))?(?=\s|$)/i))) {
    out.due_date = addDays(ctx.today, 1); matched.push("date"); takeTrailingHour(m); s = cut(s, m);
  } else if ((m = s.match(/(?:^|\s)(?:اليوم|الليلة|today|tonight)(?:\s+(\d{1,2}))?(?=\s|$)/i))) {
    out.due_date = ctx.today; matched.push("date"); takeTrailingHour(m); s = cut(s, m);
  } else if ((m = s.match(/(?:^|\s)(?:بعد|in)\s+(\d+)\s*(?:ايام|أيام|يوم|days?)(?=\s|$)/i))) {
    out.due_date = addDays(ctx.today, Number(m[1])); matched.push("date"); s = cut(s, m);
  } else if ((m = s.match(/(?:^|\s)(?:بعد|in)\s+(?:اسبوع|أسبوع|a week|week)(?=\s|$)/i))) {
    out.due_date = addDays(ctx.today, 7); matched.push("date"); s = cut(s, m);
  } else if ((m = s.match(new RegExp(`(?:^|\\s)(?:يوم\\s+)?(${WEEKDAY_ANY.source})(?:\\s+(?:الجاي|الجايه|الجاية|القادم|القادمه|القادمة|next|this))?(?:\\s+(\\d{1,2}))?(?=\\s|$)`, "i")))) {
    const idx = weekdayIndex(m[1]!);
    if (idx !== null) {
      let d = addDays(ctx.today, 1);
      while (weekdayOf(d) !== idx) d = addDays(d, 1);
      out.due_date = d; matched.push("date"); takeTrailingHour(m); s = cut(s, m);
    }
  } else if ((m = s.match(/(?:^|\s)(?:next|الاسبوع الجاي|الأسبوع الجاي|الأسبوع القادم)\s*(?:week)?(?=\s|$)/i))) {
    out.due_date = addDays(ctx.today, 7); matched.push("date"); s = cut(s, m);
  }
  // كلمة فترة وحدها (الصبح / الظهر) بلا رقم
  if (hour === null && (m = s.match(new RegExp(`(?:^|\\s)(${periodAlt})(?=\\s|$)`, "i")))) {
    const p = periodOf(m[1]); if (p && p[1]) { hour = cfg.period_hours[p[1]] as number; period = p[0]; matched.push("time"); s = cut(s, m); }
  }
  if (hour !== null) {
    const h = resolveHour(hour, period, ctx.ambiguousPmUntil);
    if (h !== null && minute >= 0 && minute < 60) out.due_time = hhmm(h, minute);
  }

  // 9) إكمال التكرار الناقص من التاريخ (كل أسبوع ⇒ يوم الاستحقاق؛ كل شهر ⇒ يوم الاستحقاق)
  if (out.recurrence) {
    const anchor = out.due_date ?? ctx.today;
    if (out.recurrence.kind === "weekly" && out.recurrence.byday.length === 0) out.recurrence = { kind: "weekly", byday: [weekdayOf(anchor)] };
    if (out.recurrence.kind === "monthly_day" && out.recurrence.day === 0) out.recurrence = { kind: "monthly_day", day: Number(anchor.slice(8, 10)) };
    out.recur_from = defaultRecurFrom(out.recurrence);
    if (!out.due_date) out.due_date = nextMatching(out.recurrence, ctx.today, ctx.weekStart, false);
  }
  // التذكير يحتاج موعدًا: بلا تاريخ ⇒ اليوم
  if (out.reminder && !out.due_date) out.due_date = ctx.today;

  // 10) العنوان = ما تبقى؛ والثقة
  out.title = s.replace(/^[\s،,:-]+|[\s،,:-]+$/g, "").trim();
  const leftover = norm(out.title);
  let conf = matched.length ? 0.95 : 0.85;
  if (!out.title) conf = 0.3;
  else {
    if (/(^|\s)(كل|الساعه|الساعة|بعد|قبل|ذكرني|every|at|remind)(\s|$)/.test(leftover)) conf -= 0.4;
    if (/\d/.test(leftover)) conf -= 0.3;
    if (out.title.length > 120) conf -= 0.2;
  }
  out.confidence = Math.max(0, Math.min(1, Number(conf.toFixed(2))));
  return out;
}

/** هل نحتاج task_parser بالذكاء الاصطناعي؟ (ب.4) */
export function needsAiFallback(p: ParsedTask): boolean {
  return cfg.deterministic_first && p.confidence < cfg.ai_fallback_below_confidence;
}
