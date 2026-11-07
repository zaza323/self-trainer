import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { award } from "@/modules/game/service";
import { instantForLocal, localParts } from "@/modules/notifications/plan";
import { addDays, daysBetween, type WeekStart } from "@/modules/planner/recurrence";
import { scheduledOn, weekStartOf, weeklyAdherence, type HabitSchedule, type Checkin } from "@/modules/planner/habits";
import { awardPlannerXp } from "@/modules/planner/xp-service";
import { paceConfig, baselines, outcomeFor, inDiscovery, capModeFor, type CapMode, proposeIncrement, stretchFor, paceRising, habitConsolidated, achievedDays, type DayMetrics, type IncrementKind, type NewHabitState } from "./rules";

type Db = SupabaseClient;
export type Profile = { id: string; age_mode: AgeMode; timezone: string };
export type IncrementRow = { over_cap?: boolean; discovery?: boolean; achieved_ratio?: number | null; achieved_value?: number | null; gap?: number | null; id: string; profile_id: string; week_start: string; kind: IncrementKind; metric: string | null; from_value: number | null; target_value: number | null; description: string | null; status: string; achieved_days: number | null; window_days: number | null; requires_guardian: boolean; decided_at: string | null; created_at: string };
const ACTIVE = ["accepted", "edited"];

/** مؤشرات يوم محلي واحد (ح.2). الإنجازات الرجعية تدخل الأولويات المنجزة. */
/** bedtime_adherence (تقريب موثَّق في VERIFY-LATER): آخر استعمال للتطبيق في اليوم المحلي ≤ موعد النوم المضبوط. */
export async function dayMetrics(db: Db, p: Profile, date: string, habits: Array<{ id: string; schedule: HabitSchedule; checkins: Checkin[] }>, weekStart: WeekStart, bedtime: string | null): Promise<DayMetrics> {
  const start = instantForLocal(date, "00:00", p.timezone).toISOString(), end = instantForLocal(addDays(date, 1), "00:00", p.timezone).toISOString();
  const [{ data: opens }, { data: checkins }, { data: done }, { data: retro }, { data: focus }, { data: fus }, { data: missions }] = await Promise.all([
    db.from("app_opens").select("local_date, last_at").eq("profile_id", p.id).eq("local_date", date),
    db.from("daily_checkins").select("moment, top_priorities, status, local_date").eq("profile_id", p.id).in("local_date", [date, addDays(date, -1)]).eq("status", "answered"),
    db.from("planner_tasks").select("id").eq("profile_id", p.id).eq("status", "done").gte("completed_at", start).lt("completed_at", end),
    db.from("retro_completions").select("id").eq("profile_id", p.id).gte("approx_at", start).lt("approx_at", end),
    db.from("planner_focus_sessions").select("minutes").eq("profile_id", p.id).gte("started_at", start).lt("started_at", end),
    db.from("planner_followups").select("status").eq("profile_id", p.id).eq("occurrence_date", date),
    db.from("missions").select("difficulty, gate2").eq("profile_id", p.id).in("status", ["reflected", "transferred"]).gte("completed_at", start).lt("completed_at", end),
  ]);
  const doneIds = new Set(((done ?? []) as Array<{ id: string }>).map((x) => x.id));
  const rows = (checkins ?? []) as Array<{ moment: string; top_priorities: Array<{ task_id: string | null }>; local_date: string }>;
  const plan = rows.find((r) => r.local_date === date && r.moment === "morning_plan") ?? rows.find((r) => r.local_date === addDays(date, -1) && (r.moment === "night_plan" || r.moment === "muhasaba"));
  const prioritiesDone = (plan?.top_priorities ?? []).filter((x) => x.task_id && doneIds.has(x.task_id)).length + (retro ?? []).length;
  const fuRows = (fus ?? []) as Array<{ status: string }>;
  const fuDone = fuRows.filter((f) => f.status === "done" || f.status === "partial").length, fuMissed = fuRows.filter((f) => f.status === "missed").length;
  const shown = ((missions ?? []) as Array<{ difficulty: number; gate2: string | null }>).filter((m) => m.gate2 === "shown");
  const values: Record<string, number | null> = {
    priorities_done_per_day: plan || (retro ?? []).length ? prioritiesDone : null,
    focus_minutes_per_day: ((focus ?? []) as Array<{ minutes: number }>).reduce((a, f) => a + f.minutes, 0),
    follow_through: fuDone + fuMissed > 0 ? fuDone / (fuDone + fuMissed) : null,
    mission_difficulty: shown.length ? shown.reduce((a, m) => a + m.difficulty, 0) / shown.length : null,
  };
  for (const h of habits) if (scheduledOn(h.schedule, date, weekStart)) values[`habit_adherence:${h.id}`] = h.checkins.some((c) => c.date === date && c.done) ? 1 : 0;
  const open = ((opens ?? []) as Array<{ last_at: string }>)[0];
  if (bedtime && open) values.bedtime_adherence = localParts(new Date(open.last_at), p.timezone).hhmm <= bedtime.slice(0, 5) ? 1 : 0;
  const active = Boolean((opens ?? []).length || plan || doneIds.size || (retro ?? []).length || fuDone + fuMissed > 0);
  return { date, active, values };
}

async function loadHabits(db: Db, profileId: string) {
  const { data } = await db.from("planner_habits").select("id, title, schedule, created_at").eq("profile_id", profileId).eq("archived", false);
  const out: Array<{ id: string; title: string; schedule: HabitSchedule; created_at: string; checkins: Checkin[] }> = [];
  for (const h of (data ?? []) as Array<{ id: string; title: string; schedule: HabitSchedule; created_at: string }>) {
    const { data: ci } = await db.from("planner_habit_checkins").select("date, done, flex_used").eq("habit_id", h.id);
    out.push({ ...h, checkins: (ci ?? []) as Checkin[] });
  }
  return out;
}

export async function daysWindow(db: Db, p: Profile, today: string, n: number, weekStart: WeekStart): Promise<DayMetrics[]> {
  const habits = await loadHabits(db, p.id);
  const bedtime = (await effective<string | null>(db, p.id, "target_bedtime")).value;
  const out: DayMetrics[] = [];
  for (let i = 1; i <= n; i++) out.push(await dayMetrics(db, p, addDays(today, -i), habits, weekStart, bedtime));
  return out;
}

export type WeeklyResult = { baseline: Record<string, number> | null; evaluated: Array<{ id: string; outcome: string; achievedDays: number }>; proposed: IncrementRow | null; xp: number; paceRisingAwarded: boolean };

/**
 * الدورة الأسبوعية (ح.5): خط الأساس، تقييم الزيادة النشطة (≥80% تحقيق ⇒ XP، 50–80% تثبيت، <50% رجوع)،
 * تثبيت العادة الجديدة (XP)، «وتيرتك ارتفعت»، ثم اقتراح زيادة واحدة (child يحتاج موافقة المربي إن ضُبط). idempotent لكل أسبوع.
 */
export async function runWeeklyPace(admin: Db, p: Profile, now = new Date()): Promise<WeeklyResult> {
  const today = localParts(now, p.timezone).date;
  const weekStart = (await effective<WeekStart>(admin, p.id, "week_start_day")).value;
  const ws = weekStartOf(today, weekStart);
  const window = await daysWindow(admin, p, today, paceConfig.lookback_days, weekStart);
  const b = baselines(window);
  let xp = 0;
  if (b) await admin.from("pace_baselines").upsert(Object.entries(b.values).map(([metric, baseline]) => ({ profile_id: p.id, metric, week_start: ws, baseline, sample_days: b.sampleDays })), { onConflict: "profile_id,metric,week_start" });
  // تقييم الزيادات النشطة من أسابيع سابقة
  const { data: actives } = await admin.from("growth_increments").select("*").eq("profile_id", p.id).in("status", ACTIVE).lt("week_start", ws);
  const evaluated: WeeklyResult["evaluated"] = [];
  let previous: { kind: IncrementKind; metric: string | null; target: number | null; outcome: "achieved" | "held" | "stepped_back" | null } | null = null;
  for (const inc of (actives ?? []) as IncrementRow[]) {
    // نافذة الزيادة = أسبوعها (من week_start)، حتمية ومستقلة عن ساعة الخادم وقت القرار
    const since = inc.week_start;
    const span = window.filter((d) => d.date >= since && d.date < today).slice(0, paceConfig.evaluation_window_days);
    const vals = inc.metric ? span.map((d) => d.values[inc.metric!] ?? null) : [];
    const ach = inc.metric && inc.target_value !== null ? achievedDays(vals, Number(inc.target_value)) : 0;
    const nums = vals.filter((v): v is number => typeof v === "number");
    const achievedValue = nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3)) : null;
    const target = inc.target_value === null ? null : Number(inc.target_value);
    const ratio = span.length ? Number((ach / span.length).toFixed(3)) : null;
    // الهدف فوق السقف أو في الاكتشاف وغير المحقق ⇒ noted (معلومة فقط، بلا رجوع)
    const outcome = inc.kind === "hold" || inc.kind === "reallocate" || inc.kind === "new_habit" ? (span.length ? "achieved" : "held") : outcomeFor({ achievedDays: ach, windowDays: Math.max(1, span.length), overCap: Boolean(inc.over_cap), discovery: Boolean(inc.discovery) });
    await admin.from("growth_increments").update({ status: outcome, achieved_days: ach, window_days: span.length, achieved_ratio: ratio, achieved_value: achievedValue, gap: target !== null && achievedValue !== null ? Number((target - achievedValue).toFixed(3)) : null }).eq("id", inc.id);
    if (outcome === "achieved" && inc.kind !== "hold") xp += await awardPlannerXp(admin, p.id, "increment_achieved", inc.id, now);
    evaluated.push({ id: inc.id, outcome, achievedDays: ach });
    if (outcome !== "noted") previous = { kind: inc.kind, metric: inc.metric, target, outcome };
  }
  if (!previous) {
    const { data: last } = await admin.from("growth_increments").select("*").eq("profile_id", p.id).in("status", ["achieved", "held", "stepped_back"]).order("week_start", { ascending: false }).limit(1);
    const l = (last ?? [])[0] as IncrementRow | undefined;
    if (l) previous = { kind: l.kind, metric: l.metric, target: l.target_value === null ? null : Number(l.target_value), outcome: l.status as "achieved" | "held" | "stepped_back" };
  }
  // العادات الجديدة والتثبيت
  const habits = await loadHabits(admin, p.id);
  const newHabits: NewHabitState[] = habits.map((h) => {
    const createdDaysAgo = daysBetween(h.created_at.slice(0, 10), today);
    const weeks = Math.max(1, Math.min(paceConfig.consolidate.weeks * 2, Math.ceil(createdDaysAgo / 7)));
    const weeklyAdh = Array.from({ length: weeks }, (_, k) => weeklyAdherence(h.schedule, h.checkins, addDays(ws, -7 * (weeks - k)), weekStart));
    return { habitId: h.id, title: h.title, createdDaysAgo, weeklyAdherence: weeklyAdh };
  }).filter((h) => h.createdDaysAgo <= paceConfig.new_habit_window_days);
  for (const h of newHabits) if (habitConsolidated(h)) xp += await awardPlannerXp(admin, p.id, "habit_consolidated", h.habitId, now);
  // «وتيرتك ارتفعت»
  let paceRisingAwarded = false;
  const { data: hist } = await admin.from("pace_baselines").select("metric, week_start, baseline").eq("profile_id", p.id).order("week_start", { ascending: true });
  const byMetric = new Map<string, number[]>();
  for (const r of (hist ?? []) as Array<{ metric: string; baseline: number }>) byMetric.set(r.metric, [...(byMetric.get(r.metric) ?? []), Number(r.baseline)]);
  for (const [metric, series] of byMetric) if (!metric.startsWith("habit_adherence") && paceRising(series)) { paceRisingAwarded = (await award(admin, p.id, "pace_rising", 1, metric, null)) || paceRisingAwarded; }
  // اقتراح الأسبوع (مرة واحدة)
  const { data: thisWeek } = await admin.from("growth_increments").select("*").eq("profile_id", p.id).eq("week_start", ws).neq("kind", "reallocate");
  let proposed: IncrementRow | null = ((thisWeek ?? [])[0] as IncrementRow | undefined) ?? null;
  const [maxActive, stretchSetting, guardianReq] = await Promise.all([effective<number>(admin, p.id, "max_active_increments"), effective<number>(admin, p.id, "pace_stretch_percent"), effective<boolean>(admin, p.id, "increments_require_guardian")]);
  const { data: stillActive } = await admin.from("growth_increments").select("id").eq("profile_id", p.id).in("status", ACTIVE);
  if (!proposed && (stillActive ?? []).length < maxActive.value) {
    const hardWeek = (await admin.from("engagement_states").select("state").eq("profile_id", p.id).gte("date", addDays(today, -7))).data?.filter((r) => (r as { state: string }).state === "low").length ?? 0;
    const prop = proposeIncrement({ ageMode: p.age_mode, stretchPercent: stretchFor(p.age_mode, stretchSetting.value), baseline: b?.values ?? null, previous, newHabits, hardWeek: hardWeek >= paceConfig.hard_week_low_days });
    if (prop) {
      const desc = prop.kind === "consolidate" ? newHabits.find((h) => h.habitId === prop.habitId)?.title ?? null : null;
      const { data } = await admin.from("growth_increments").insert({ profile_id: p.id, week_start: ws, kind: prop.kind, metric: prop.metric, from_value: prop.from, target_value: prop.target, description: desc, requires_guardian: p.age_mode === "child" && guardianReq.value }).select("*").single();
      proposed = data as IncrementRow;
    }
  }
  return { baseline: b?.values ?? null, evaluated, proposed, xp, paceRisingAwarded };
}

/** الزيادة النشطة (أحدث مقبولة) لاستعمالها في الاقتراح الصباحي (ح.5-5). */
export async function activeIncrements(db: Db, profileId: string): Promise<IncrementRow[]> {
  const { data } = await db.from("growth_increments").select("*").eq("profile_id", profileId).in("status", ACTIVE).order("week_start", { ascending: false });
  return (data ?? []) as IncrementRow[];
}

export async function latestBaselines(db: Db, profileId: string): Promise<{ now: Record<string, number>; monthAgo: Record<string, number>; weekStart: string | null }> {
  const { data } = await db.from("pace_baselines").select("metric, week_start, baseline").eq("profile_id", profileId).order("week_start", { ascending: false });
  const rows = (data ?? []) as Array<{ metric: string; week_start: string; baseline: number }>;
  const latestWeek = rows[0]?.week_start ?? null;
  const now: Record<string, number> = {}, monthAgo: Record<string, number> = {};
  for (const r of rows) {
    if (r.week_start === latestWeek && now[r.metric] === undefined) now[r.metric] = Number(r.baseline);
    if (latestWeek && r.week_start <= addDays(latestWeek, -paceConfig.self_compare_days_ago) && monthAgo[r.metric] === undefined) monthAgo[r.metric] = Number(r.baseline);
  }
  return { now, monthAgo, weekStart: latestWeek };
}

/** ط.6: «تغيير واحد بوعي» من المرآة يُصاغ كزيادة reallocate (child يحتاج موافقة المربي إن ضُبط). */
export async function createReallocateIncrement(admin: Db, p: Profile, i: { text: string; now?: Date }): Promise<IncrementRow | null> {
  const today = localParts(i.now ?? new Date(), p.timezone).date;
  const weekStart = (await effective<WeekStart>(admin, p.id, "week_start_day")).value;
  const guardianReq = (await effective<boolean>(admin, p.id, "increments_require_guardian")).value;
  const { data } = await admin.from("growth_increments").insert({ profile_id: p.id, week_start: weekStartOf(today, weekStart), kind: "reallocate", description: i.text.trim(), requires_guardian: p.age_mode === "child" && guardianReq }).select("*").single();
  return (data as IncrementRow | null) ?? null;
}

/** سياق السقف لملف: الاكتشاف (أيام منذ البداية وأيام النشاط)، النمط (ناعم/ثابت)، وتاريخ الأهداف فوق السقف. */
export async function capContext(db: Db, p: { id: string; age_mode: AgeMode; created_at?: string | null }, today: string): Promise<{ discovery: boolean; mode: CapMode; history: Array<{ over_cap: boolean; achieved_ratio: number | null }> }> {
  const [{ data: prof }, { data: opens }, { data: first }, mode, { data: hist }] = await Promise.all([
    p.created_at ? Promise.resolve({ data: { created_at: p.created_at } }) : db.from("profiles").select("created_at").eq("id", p.id).maybeSingle(),
    db.from("app_opens").select("local_date").eq("profile_id", p.id),
    db.from("app_opens").select("local_date").eq("profile_id", p.id).order("local_date", { ascending: true }).limit(1),
    effective<CapMode>(db, p.id, "pace_cap_mode"),
    db.from("growth_increments").select("over_cap, achieved_ratio").eq("profile_id", p.id).eq("over_cap", true),
  ]);
  const created = (prof as { created_at: string } | null)?.created_at?.slice(0, 10) ?? today;
  const firstOpen = ((first ?? [])[0] as { local_date: string } | undefined)?.local_date ?? created;
  const start = firstOpen < created ? firstOpen : created;
  return {
    discovery: inDiscovery({ daysSinceStart: daysBetween(start, today), activeDays: (opens ?? []).length }),
    mode: capModeFor(p.age_mode, mode.value),
    history: ((hist ?? []) as Array<{ over_cap: boolean; achieved_ratio: number | string | null }>).map((h) => ({ over_cap: h.over_cap, achieved_ratio: h.achieved_ratio === null ? null : Number(h.achieved_ratio) })),
  };
}
