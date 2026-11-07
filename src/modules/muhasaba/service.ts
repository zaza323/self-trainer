import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planner, type AgeMode } from "@/shared/config";
import { effective } from "@/modules/settings";
import { localParts } from "@/modules/notifications/plan";
import { addDays, type WeekStart } from "@/modules/planner/recurrence";
import { listTasks } from "@/modules/planner/service";
import { groupTasks } from "@/modules/planner/views";
import { awardPlannerXp } from "@/modules/planner/xp-service";
import { recordPlannerEvidence } from "@/modules/planner/evidence-service";
import { m2Value } from "@/modules/planner/evidence-values";
import { scheduledFor, followupSettings } from "@/modules/followups/service";
import { checkinsOn, todaysPriorities } from "@/modules/moments/service";
import { stepsFor, validateShortfalls, type MuhasabaStep, type Shortfall } from "./flow";
import type { ModelCaller } from "@/modules/companion/model";
import { muhasabaCoach } from "@/modules/companion/functions/muhasaba-coach";

type Db = SupabaseClient;
export type Profile = { id: string; user_id: string; age_mode: AgeMode; timezone: string };
export type MuhasabaEntry = { id: string; profile_id: string; local_date: string; achieved: Array<{ text: string; source: string; task_id?: string | null }>; shortfalls: Shortfall[]; next_steps: Array<{ text: string; task_id: string | null }>; rest_day: boolean; completed: boolean; session_id: string | null };
export type MuhasabaView = { entry: MuhasabaEntry; steps: MuhasabaStep[]; suggestedAchieved: MuhasabaEntry["achieved"]; suggestedShortfalls: Array<{ text: string; task_id: string | null }>; candidateNext: Array<{ text: string; task_id: string | null }>; restDay: boolean };

/** P46: يبدأ الجلسة (أو يعيدها) مع قوائم مقترحة من «تمّت» وأولويات الصباح والإنجازات الرجعية و«ما صارت». يوم الاستراحة = وضع الاستراحة أو لا شيء مجدول. */
export async function startMuhasaba(db: Db, p: Profile, now: Date, weekStart: WeekStart): Promise<MuhasabaView> {
  const today = localParts(now, p.timezone).date;
  const [brk, tasks, todayRows, yRows, { data: fus }, { data: retro }] = await Promise.all([
    effective<boolean>(db, p.id, "break_mode"), listTasks(db, p.id), checkinsOn(db, p.id, today), checkinsOn(db, p.id, addDays(today, -1)),
    db.from("planner_followups").select("item_kind, item_id, status").eq("profile_id", p.id).eq("occurrence_date", today),
    db.from("retro_completions").select("title").eq("profile_id", p.id).gte("approx_at", `${today}T00:00:00Z`),
  ]);
  const groups = groupTasks(tasks, today);
  const sched = await scheduledFor(db, p, today, await followupSettings(db, p.id), weekStart);
  const restDay = brk.value || (sched.length === 0 && groups.today.length === 0 && todaysPriorities(todayRows, yRows).length === 0);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const doneToday = tasks.filter((t) => t.status === "done" && t.completed_at && localParts(new Date(t.completed_at), p.timezone).date === today);
  const achieved: MuhasabaEntry["achieved"] = [
    ...doneToday.map((t) => ({ text: t.title, source: "done", task_id: t.id })),
    ...((fus ?? []) as Array<{ item_kind: string; item_id: string; status: string }>).filter((f) => f.status === "done" && f.item_kind !== "task").map((f) => ({ text: sched.find((s) => s.id === f.item_id)?.title ?? f.item_kind, source: "followup", task_id: null })),
    ...((retro ?? []) as Array<{ title: string }>).map((r) => ({ text: r.title, source: "retro", task_id: null })),
  ];
  const priorities = todaysPriorities(todayRows, yRows);
  const missed = ((fus ?? []) as Array<{ item_kind: string; item_id: string; status: string }>).filter((f) => f.status === "missed" && f.item_kind === "task").map((f) => ({ text: byId.get(f.item_id)?.title ?? "", task_id: f.item_id }));
  const notDone = priorities.filter((x) => !x.task_id || byId.get(x.task_id)?.status !== "done").map((x) => ({ text: x.text, task_id: x.task_id }));
  const suggestedShortfalls = [...missed, ...notDone].filter((x, i, arr) => x.text && arr.findIndex((y) => (y.task_id ?? y.text) === (x.task_id ?? x.text)) === i);
  const candidateNext = [...suggestedShortfalls, ...groups.upcoming.slice(0, 3).map((t) => ({ text: t.title, task_id: t.id })), ...groups.overdue.slice(0, 2).map((t) => ({ text: t.title, task_id: t.id }))].slice(0, 6);
  let { data: entry } = await db.from("muhasaba_entries").select("*").eq("profile_id", p.id).eq("local_date", today).maybeSingle();
  if (!entry) {
    const { data: sess } = await db.from("companion_sessions").insert({ profile_id: p.id, mode: "daily_moment", daily_moment: "muhasaba" }).select("id").single();
    const { data: created } = await db.from("muhasaba_entries").insert({ profile_id: p.id, local_date: today, rest_day: restDay, session_id: (sess?.id as string) ?? null, achieved }).select("*").single();
    entry = created;
  }
  return { entry: entry as MuhasabaEntry, steps: stepsFor(p.age_mode, (entry as MuhasabaEntry).rest_day), suggestedAchieved: achieved, suggestedShortfalls, candidateNext, restDay: (entry as MuhasabaEntry).rest_day };
}

/** حفظ خطوة. التقصير ≤ 3 وبسبب لواحد على الأقل. عند «المرة القادمة»: تُحفظ كأولويات الصباح (daily_checkins night_plan) + XP muhasaba_done وdaily_plan_set. */
export async function saveMuhasabaStep(db: Db, admin: Db | null, p: Profile, i: { entryId: string; step: MuhasabaStep; achieved?: MuhasabaEntry["achieved"]; shortfalls?: Shortfall[]; nextSteps?: Array<{ text: string; task_id: string | null }>; now?: Date }): Promise<{ ok: boolean; error?: string; completed: boolean; xp: number }> {
  const now = i.now ?? new Date();
  const { data: e } = await db.from("muhasaba_entries").select("*").eq("id", i.entryId).maybeSingle();
  if (!e) return { ok: false, error: "not_found", completed: false, xp: 0 };
  const entry = e as MuhasabaEntry;
  if (i.step === "achieved" || i.step === "did_well") { await db.from("muhasaba_entries").update({ achieved: i.achieved ?? entry.achieved }).eq("id", entry.id); return { ok: true, completed: false, xp: 0 }; }
  if (i.step === "shortfall") {
    const v = validateShortfalls(i.shortfalls ?? []);
    if (!v.ok) return { ok: false, error: v.reason, completed: false, xp: 0 };
    await db.from("muhasaba_entries").update({ shortfalls: i.shortfalls ?? [] }).eq("id", entry.id);
    return { ok: true, completed: false, xp: 0 };
  }
  const next = (i.nextSteps ?? []).filter((x) => x.text.trim()).slice(0, 3);
  if (next.length === 0) return { ok: false, error: "next_required", completed: false, xp: 0 };
  await db.from("muhasaba_entries").update({ next_steps: next, completed: true }).eq("id", entry.id);
  if (entry.session_id) await db.from("companion_sessions").update({ ended_at: now.toISOString(), summary: next.map((x) => x.text).join("، ") }).eq("id", entry.session_id);
  // ز.4: الخطوة القادمة تصبح أولويات الصباح (تأكيد)
  await db.from("daily_checkins").upsert({ profile_id: p.id, local_date: entry.local_date, moment: "night_plan", status: "answered", answered_at: now.toISOString(), top_priorities: next, session_id: entry.session_id }, { onConflict: "profile_id,local_date,moment" });
  await db.from("daily_checkins").upsert({ profile_id: p.id, local_date: entry.local_date, moment: "muhasaba", status: "answered", answered_at: now.toISOString(), top_priorities: next, session_id: entry.session_id }, { onConflict: "profile_id,local_date,moment" });
  let xp = 0;
  if (admin) {
    xp += await awardPlannerXp(admin, p.id, "muhasaba_done", `${p.id}:${entry.local_date}`, now);
    xp += await awardPlannerXp(admin, p.id, "daily_plan_set", `${p.id}:${addDays(entry.local_date, 1)}`, now);
  }
  return { ok: true, completed: true, xp };
}

/** ز.5 M1: سبب تقصير مكتوب ⇒ مرشح reflection_coach (ai) على self_awareness؛ جلد الذات يُعاد للسلوك. */
export async function reasonTurn(admin: Db, caller: ModelCaller, p: Profile, i: { shortfallText: string | null; reasonText: string; dedupeKey: string; now?: Date }): Promise<{ reply: string; source: "ai" | "fixed"; m1: boolean; selfBlame: boolean }> {
  const r = await muhasabaCoach({ db: admin, caller, profileId: p.id, mode: p.age_mode, shortfallText: i.shortfallText, reasonText: i.reasonText });
  let m1 = false;
  const c = r.candidates.find((x) => x.capability_id === "self_awareness");
  if (c) m1 = await recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: "M1", capability: "self_awareness", type: "reflection_quality", source: "ai", value: c.value, dedupeKey: i.dedupeKey }, i.now);
  return { reply: r.reply, source: r.source, m1, selfBlame: r.selfBlame };
}

/** ز.5 M2: خطوة المحاسبة نُفذت في اليوم التالي ⇒ +0.6 (config)؛ لا سلبي. idempotent لليوم. */
export async function evaluateMuhasabaNextDay(admin: Db, p: Profile, today: string, now = new Date()): Promise<boolean> {
  const { data: e } = await admin.from("muhasaba_entries").select("next_steps").eq("profile_id", p.id).eq("local_date", addDays(today, -1)).eq("completed", true).maybeSingle();
  const steps = (e?.next_steps as Array<{ task_id: string | null; text: string }> | undefined) ?? [];
  const ids = steps.map((s) => s.task_id).filter((x): x is string => Boolean(x));
  if (ids.length === 0) return false;
  const { data: done } = await admin.from("planner_tasks").select("id").in("id", ids).eq("status", "done");
  const v = m2Value(Boolean(done?.length), (planner.daily_moments as unknown as { moments: { muhasaba: { m2_value: number } } }).moments.muhasaba.m2_value);
  if (v === null) return false;
  return recordPlannerEvidence(admin, { profileId: p.id, ageMode: p.age_mode, ruleId: "M2", capability: "planning", type: "strategy_fit", source: "auto", value: v, dedupeKey: today }, now);
}
