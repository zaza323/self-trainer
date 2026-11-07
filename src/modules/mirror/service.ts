import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { instantForLocal, localParts } from "@/modules/notifications/plan";
import { addDays } from "@/modules/planner/recurrence";
import { awardPlannerXp } from "@/modules/planner/xp-service";
import { recordPlannerEvidence } from "@/modules/planner/evidence-service";
import { createReallocateIncrement } from "@/modules/pace/service";
import { prefillSegments, gaps, distribution, unknownShare, plannedShare, energyHours, detectPatterns, predictionAwareness, pickPredictionCategories, UNKNOWN, type Segment, type Pattern } from "./reconstruct";
import categoriesContent from "@content/reconstruction_categories.ar.json";

type Db = SupabaseClient;
export type Profile = { id: string; age_mode: AgeMode; timezone: string };
export type ReconstructionRow = { id: string; profile_id: string; local_date: string; source: "muhasaba" | "onboarding" | "manual"; completed: boolean; unknown_minutes: number; screen_estimate_min: number | null; created_at: string };
export type ActualBlockRow = Segment & { id: string; reconstruction_id: string };
export type MirrorReportRow = { id: string; profile_id: string; period_start: string; period_end: string; days_count: number; distribution: Record<string, number>; predictions: Array<{ category: string; predicted_hours: number; actual_hours: number }>; goal_alignment: Array<{ goal_id: string; title: string; minutes: number }>; patterns: Pattern[]; user_noticed: string | null; chosen_change_text: string | null; created_at: string; follow_up_of?: string | null; goal_answer?: string | null };

export async function categoriesFor(db: Db, profileId: string): Promise<Array<{ key: string; label: string }>> {
  const keys = (await effective<string[]>(db, profileId, "reconstruction_categories")).value;
  const labels = categoriesContent.labels as Record<string, string>;
  const { data: custom } = await db.from("reconstruction_categories").select("key, label").eq("profile_id", profileId).eq("active", true);
  const out = keys.map((k) => ({ key: k, label: labels[k] ?? k }));
  for (const c of (custom ?? []) as Array<{ key: string; label: string }>) if (!out.some((o) => o.key === c.key)) out.push(c);
  return out;
}

/** P48: يبدأ إعادة بناء يوم (أو يعيدها) مع الملء المسبق مرة واحدة (idempotent). */
export async function getOrCreateReconstruction(db: Db, p: Profile, i: { date: string; source: ReconstructionRow["source"]; now: Date }): Promise<{ rec: ReconstructionRow; blocks: ActualBlockRow[]; gaps: Array<{ start: string; end: string }> }> {
  let { data: rec } = await db.from("day_reconstructions").select("*").eq("profile_id", p.id).eq("local_date", i.date).maybeSingle();
  const dayStart = instantForLocal(i.date, "00:00", p.timezone).toISOString();
  const dayEnd = instantForLocal(addDays(i.date, 1), "00:00", p.timezone).toISOString();
  const until = i.now.toISOString() < dayEnd ? i.now.toISOString() : dayEnd;
  if (!rec) {
    const { data: created, error } = await db.from("day_reconstructions").insert({ profile_id: p.id, local_date: i.date, source: i.source }).select("*").single();
    if (error) throw error;
    rec = created;
    const [{ data: fus }, { data: focus }, { data: blocks }, { data: rest }, { data: retro }, { data: tasks }, wake] = await Promise.all([
      db.from("planner_followups").select("item_kind, item_id, scheduled_end, status").eq("profile_id", p.id).eq("occurrence_date", i.date).eq("status", "done"),
      db.from("planner_focus_sessions").select("started_at, ended_at, minutes, task_id").eq("profile_id", p.id).gte("started_at", dayStart).lt("started_at", dayEnd),
      db.from("planner_time_blocks").select("starts_at, ends_at, task_id, kept").eq("profile_id", p.id).gte("starts_at", dayStart).lt("starts_at", dayEnd),
      db.from("rest_sessions").select("started_at, ended_at, planned_min, activity_key").eq("profile_id", p.id).gte("started_at", dayStart).lt("started_at", dayEnd),
      db.from("retro_completions").select("title, approx_at").eq("profile_id", p.id).gte("approx_at", dayStart).lt("approx_at", dayEnd),
      db.from("planner_tasks").select("id, title, estimate_min").eq("profile_id", p.id),
      effective<string | null>(db, p.id, "target_wake"),
    ]);
    const titles = new Map(((tasks ?? []) as Array<{ id: string; title: string; estimate_min: number | null }>).map((t) => [t.id, t]));
    const segs = prefillSegments({
      followupsDone: ((fus ?? []) as Array<{ item_kind: string; item_id: string; scheduled_end: string }>).filter((f) => f.item_kind === "task").map((f) => { const t = titles.get(f.item_id); const mins = t?.estimate_min ?? 30; return { title: t?.title ?? "", startsAt: new Date(new Date(f.scheduled_end).getTime() - mins * 60000).toISOString(), endsAt: f.scheduled_end, category: "study" }; }),
      focusSessions: ((focus ?? []) as Array<{ started_at: string; ended_at: string | null; minutes: number; task_id: string | null }>).map((f) => ({ ...f, title: f.task_id ? titles.get(f.task_id)?.title ?? null : null })),
      blocks: ((blocks ?? []) as Array<{ starts_at: string; ends_at: string; task_id: string | null; kept: boolean | null }>).filter((b) => b.kept).map((b) => ({ starts_at: b.starts_at, ends_at: b.ends_at, title: b.task_id ? titles.get(b.task_id)?.title ?? "" : "" })),
      restSessions: (rest ?? []) as Array<{ started_at: string; ended_at: string | null; planned_min: number; activity_key: string }>,
      retro: ((retro ?? []) as Array<{ title: string; approx_at: string }>).map((r) => ({ ...r, minutes: 30 })),
      sleep: { wake: wake.value ? instantForLocal(i.date, wake.value, p.timezone).toISOString() : null, dayStart },
    });
    if (segs.length) await db.from("time_blocks_actual").insert(segs.map((s) => ({ reconstruction_id: (rec as ReconstructionRow).id, ...s })));
  }
  const { data: rows } = await db.from("time_blocks_actual").select("*").eq("reconstruction_id", (rec as ReconstructionRow).id).order("starts_at", { ascending: true });
  const blocks = (rows ?? []) as ActualBlockRow[];
  return { rec: rec as ReconstructionRow, blocks, gaps: gaps(blocks, dayStart, until) };
}

export async function addActualBlock(db: Db, i: { reconstructionId: string; startsAt: string; endsAt: string; category: string; label?: string | null; energy?: "high" | "normal" | "low" | null; origin: Segment["origin"] }): Promise<{ ok: boolean; error?: string }> {
  if (new Date(i.endsAt) <= new Date(i.startsAt)) return { ok: false, error: "invalid_range" };
  const { error } = await db.from("time_blocks_actual").insert({ reconstruction_id: i.reconstructionId, starts_at: i.startsAt, ends_at: i.endsAt, category: i.category, label: i.label ?? null, energy: i.energy ?? null, origin: i.origin, was_planned: false });
  return { ok: !error, error: error?.message };
}
export async function removeActualBlock(db: Db, id: string): Promise<void> { await db.from("time_blocks_actual").delete().eq("id", id); }

/** إتمام يوم: unknown_minutes محسوبة؛ XP day_reconstructed مرة يوميًا. */
export async function completeReconstruction(db: Db, admin: Db | null, p: Profile, i: { reconstructionId: string; screenEstimateMin?: number | null; now?: Date }): Promise<{ ok: boolean; xp: number }> {
  const { data: rows } = await db.from("time_blocks_actual").select("*").eq("reconstruction_id", i.reconstructionId);
  const segs = (rows ?? []) as ActualBlockRow[];
  const unknown = Math.round(distribution(segs)[UNKNOWN] ?? 0);
  const { data, error } = await db.from("day_reconstructions").update({ completed: true, unknown_minutes: unknown, screen_estimate_min: i.screenEstimateMin ?? null }).eq("id", i.reconstructionId).select("local_date").single();
  if (error) return { ok: false, xp: 0 };
  const xp = admin ? await awardPlannerXp(admin, p.id, "day_reconstructed", `${p.id}:${(data as { local_date: string }).local_date}`, i.now) : 0;
  return { ok: true, xp };
}

/** ط.5: المرآة من الأيام المعاد بناؤها (متوسط)، أرقام حتمية، أنماط حتمية، غاياتك ووقتك. */
export async function buildMirror(db: Db, p: Profile, i: { days: number; now: Date }): Promise<{ report: Omit<MirrorReportRow, "id" | "created_at" | "user_noticed" | "chosen_change_text" | "predictions">; dayLists: Segment[][]; predictionCategories: string[]; unknownShare: number; plannedShare: number; energyHours: number[] } | null> {
  const today = localParts(i.now, p.timezone).date;
  const { data: recs } = await db.from("day_reconstructions").select("*").eq("profile_id", p.id).eq("completed", true).lte("local_date", today).order("local_date", { ascending: false }).limit(i.days);
  const rs = (recs ?? []) as ReconstructionRow[];
  if (rs.length === 0) return null;
  const dayLists: Segment[][] = [];
  for (const r of rs) { const { data: b } = await db.from("time_blocks_actual").select("*").eq("reconstruction_id", r.id); dayLists.push((b ?? []) as ActualBlockRow[]); }
  const all = dayLists.flat();
  const total = distribution(all);
  const dist: Record<string, number> = {};
  for (const [k, v] of Object.entries(total)) dist[k] = Math.round(v / rs.length);
  // غاياتك ووقتك: مهام مرتبطة بغاية أُنجزت في الفترة (دقائق التقدير/الفعلي)
  const start = rs[rs.length - 1]!.local_date, end = rs[0]!.local_date;
  const { data: goals } = await db.from("goals").select("id, title").eq("profile_id", p.id).eq("status", "active");
  const { data: linked } = await db.from("planner_tasks").select("linked_goal_id, estimate_min, actual_min, completed_at").eq("profile_id", p.id).eq("status", "done").not("linked_goal_id", "is", null).gte("completed_at", `${start}T00:00:00Z`).lte("completed_at", `${addDays(end, 1)}T00:00:00Z`);
  const goalMinutes = new Map<string, number>();
  for (const t of (linked ?? []) as Array<{ linked_goal_id: string; estimate_min: number | null; actual_min: number | null }>) goalMinutes.set(t.linked_goal_id, (goalMinutes.get(t.linked_goal_id) ?? 0) + (t.actual_min ?? t.estimate_min ?? 0));
  const goal_alignment = ((goals ?? []) as Array<{ id: string; title: string }>).map((g) => ({ goal_id: g.id, title: g.title, minutes: Math.round((goalMinutes.get(g.id) ?? 0) / rs.length) }));
  const patterns = detectPatterns(dayLists, p.timezone);
  const predictionCategories = pickPredictionCategories(dist, categoriesContent.goal_related_default);
  return { report: { profile_id: p.id, period_start: start, period_end: end, days_count: rs.length, distribution: dist, goal_alignment, patterns }, dayLists, predictionCategories, unknownShare: unknownShare(all), plannedShare: plannedShare(all), energyHours: energyHours(all, p.timezone) };
}

/** P49/P50: يحفظ التقرير مع التوقّعات ويولّد R1 (prediction_accuracy، self). */
export async function saveMirror(db: Db, admin: Db | null, p: Profile, i: { days: number; predictions: Array<{ category: string; predicted_hours: number }>; now: Date }): Promise<{ ok: boolean; id?: string; r1: boolean }> {
  const m = await buildMirror(db, p, { days: i.days, now: i.now });
  if (!m) return { ok: false, r1: false };
  const predictions = i.predictions.map((x) => ({ category: x.category, predicted_hours: x.predicted_hours, actual_hours: Number((((m.report.distribution[x.category] ?? 0) / 60)).toFixed(2)) }));
  // ط.6-5: مرآة متابعة إن قبل المستخدم اقتراح المتابعة لمرآة سابقة
  const { data: fu } = await db.from("mirror_suggestions").select("id, follow_up_of").eq("profile_id", p.id).eq("reason", "follow_up").eq("status", "accepted").order("decided_at", { ascending: false }).limit(1);
  const followUpOf = ((fu ?? [])[0] as { follow_up_of: string | null } | undefined)?.follow_up_of ?? null;
  const { data: already } = followUpOf ? await db.from("mirror_reports").select("id").eq("follow_up_of", followUpOf).limit(1) : { data: [] };
  const { data, error } = await db.from("mirror_reports").insert({ ...m.report, predictions, follow_up_of: already?.length ? null : followUpOf }).select("id").single();
  if (error) return { ok: false, r1: false };
  let r1 = false;
  const v = predictionAwareness(predictions);
  if (admin && v !== null) r1 = await recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: "R1", capability: "self_awareness", type: "prediction_accuracy", source: "self", value: v, dedupeKey: data.id as string }, i.now);
  return { ok: true, id: data.id as string, r1 };
}

export async function saveNoticed(db: Db, reportId: string, text: string): Promise<void> { await db.from("mirror_reports").update({ user_noticed: text.trim() }).eq("id", reportId); }

/** P51: تغيير واحد بوعي ⇒ زيادة reallocate (ح، تحتاج موافقة المربي للطفل إن ضُبط) + XP mirror_reviewed. */
export async function chooseChange(db: Db, admin: Db | null, p: Profile, i: { reportId: string; text: string; now?: Date }): Promise<{ ok: boolean; xp: number; incrementId: string | null }> {
  const { error } = await db.from("mirror_reports").update({ chosen_change_text: i.text.trim() }).eq("id", i.reportId);
  if (error) return { ok: false, xp: 0, incrementId: null };
  const inc = admin ? await createReallocateIncrement(admin, p, { text: i.text, now: i.now }) : null;
  if (inc && admin) await admin.from("mirror_reports").update({ chosen_change_increment_id: inc.id }).eq("id", i.reportId);
  const xp = admin ? await awardPlannerXp(admin, p.id, "mirror_reviewed", i.reportId, i.now) : 0;
  return { ok: true, xp, incrementId: inc?.id ?? null };
}

export async function latestMirror(db: Db, profileId: string): Promise<MirrorReportRow | null> {
  const { data } = await db.from("mirror_reports").select("*").eq("profile_id", profileId).order("created_at", { ascending: false }).limit(1);
  return ((data ?? [])[0] as MirrorReportRow | undefined) ?? null;
}

export async function saveGoalAnswer(db: Db, reportId: string, text: string): Promise<void> { await db.from("mirror_reports").update({ goal_answer: text.trim() }).eq("id", reportId); }

/**
 * أسبوع المرآة (ط.2/ط.12-10): بعد قبول اقتراح المرآة أو بداية الانضمام بالواقع، حتى تكتمل mirror_days_required إعادة بناء
 * خلال 7 أيام. خلاله تحل إعادة البناء محل خطوة المحاسبة المحددة في config، بلا لحظة جديدة.
 */
export async function isMirrorWeek(db: Db, profileId: string, today: string): Promise<boolean> {
  const since = addDays(today, -7);
  const [days, { data: acc }, { data: recs }] = await Promise.all([
    effective<number>(db, profileId, "mirror_days_required"),
    db.from("mirror_suggestions").select("id").eq("profile_id", profileId).eq("status", "accepted").gte("decided_at", instantForLocal(since, "00:00", "UTC").toISOString()).limit(1),
    db.from("day_reconstructions").select("source, completed").eq("profile_id", profileId).gte("local_date", since),
  ]);
  const rows = (recs ?? []) as Array<{ source: string; completed: boolean }>;
  const started = Boolean(acc?.length) || rows.some((r) => r.source === "onboarding");
  return started && rows.filter((r) => r.completed).length < days.value;
}
