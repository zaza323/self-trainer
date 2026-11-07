import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileRow } from "@/shared/db/types";
import { game, SUPPORT_LEVELS, support as supportCfg, type AgeMode, type SupportLevel } from "@/shared/config";
import { effective } from "@/modules/settings";
import { listMissions, OPEN_STATUSES, todayIn } from "@/modules/missions";
import { loadActiveTemplates, textByMode } from "@/modules/library";
import { localParts } from "@/modules/notifications/plan";
import { recordAppOpen } from "@/modules/engagement/service";
import { pendingFollowups, nextCardFor, scheduledFor, followupSettings, type FollowupView } from "@/modules/followups/service";
import { restSuppressedUntil } from "@/modules/rest/service";
import { engagementConfig } from "@/modules/engagement/state";
import { loadStartScreen, type StartScreenFacts } from "./service";
import type { WeekStart } from "@/modules/planner/recurrence";
import type { NextDecision, ScheduledItem } from "@/modules/followups/compute";

export type StartData = {
  facts: StartScreenFacts;
  followups: { items: FollowupView[]; presentation: "sheets" | "list" | "none" };
  next: NextDecision; soon: ScheduledItem | null;
  training: { id: string; title: string } | null;
  dndActive: boolean;
  returnFlow: { absenceHours: number; scheduledCount: number; doneCount: number } | null;
  supportBand: "L0_L1" | "L2_L3";
  weekStart: WeekStart;
};

/** P35: يجمع كل ما تحتاجه شاشة البداية حتميًا (فتح التطبيق ليس إشعارًا ولا استدعاء ذكاء اصطناعي). */
export async function loadStartData(db: SupabaseClient, profile: ProfileRow, now = new Date()): Promise<StartData> {
  const p = { id: profile.id, user_id: profile.user_id, age_mode: profile.age_mode as AgeMode, timezone: profile.timezone, display_name: profile.display_name };
  const { absenceHours } = await recordAppOpen(db, p, now);
  const weekStart = (await effective<WeekStart>(db, p.id, "week_start_day")).value;
  // 1) أمان أو طلب مربٍ معلّق
  const { data: sessions } = await db.from("companion_sessions").select("id").eq("profile_id", p.id);
  const sids = ((sessions ?? []) as Array<{ id: string }>).map((s) => s.id);
  const [{ data: hr }, { data: sf }] = await Promise.all([
    sids.length ? db.from("human_requests").select("id").in("session_id", sids).is("resolved_at", null).limit(1) : Promise.resolve({ data: [] }),
    db.from("safety_flags").select("id").eq("profile_id", p.id).eq("status", "open").limit(1),
  ]);
  const safetyPending = Boolean(hr?.length || sf?.length);
  // 2) العودة بعد انقطاع (5.5)
  const missions = await listMissions(p.id, { statuses: [...OPEN_STATUSES] });
  const { data: lastTr } = missions.length ? await db.from("mission_transitions").select("at").in("mission_id", missions.map((m) => m.id)).order("at", { ascending: false }).limit(1) : { data: [] };
  const lastAt = ((lastTr ?? [])[0] as { at?: string } | undefined)?.at;
  const comeback = Boolean(lastAt && (now.getTime() - new Date(lastAt).getTime()) / 86400000 >= game.comeback.min_gap_days);
  // 3) المتابعة
  const followups = await pendingFollowups(db, p, now, weekStart);
  const facts = await loadStartScreen(db, p, { now, safetyPending, comeback, followupsPending: followups.items.filter((f) => f.status === "pending").length });
  // مستوى دعم التخطيط ⇒ التلاشي في بطاقة التالي
  const { data: st } = await db.from("capability_states").select("support_level").eq("profile_id", p.id).eq("capability_id", "planning").maybeSingle();
  const lvl: SupportLevel = ((st as { support_level: SupportLevel } | null)?.support_level) ?? supportCfg.initial_by_age_mode[p.age_mode];
  const supportBand = SUPPORT_LEVELS.indexOf(lvl) >= SUPPORT_LEVELS.indexOf("L2_ask") ? "L2_L3" : "L0_L1";
  const doneIds = new Set<string>();
  { const { data: d } = await db.from("planner_tasks").select("id").eq("profile_id", p.id).eq("status", "done"); for (const r of (d ?? []) as Array<{ id: string }>) doneIds.add(r.id); }
  const remaining = facts.priorities.filter((x) => !x.task_id || !doneIds.has(x.task_id)).map((x) => ({ id: x.task_id, text: x.text }));
  const { decision: next, soon } = await nextCardFor(db, p, now, weekStart, { quietNow: facts.quietNow, windDownNow: facts.windDownNow, supportBand, restSuppressedUntil: await restSuppressedUntil(db, p.id, now), remainingPriorities: remaining, prioritiesTotal: facts.priorities.length });
  const templates = await loadActiveTemplates(db);
  const today = todayIn(p.timezone, now);
  const tm = missions.find((m) => !m.dismissed && (m.suggested_for === today || m.status !== "suggested"));
  const training = tm ? { id: tm.id, title: textByMode(templates.find((t) => t.id === tm.template_id)?.title, p.age_mode) || tm.template_id } : null;
  const { data: dnd } = await db.from("dnd_periods").select("id").eq("profile_id", p.id).or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`).limit(1);
  let returnFlow: StartData["returnFlow"] = null;
  if (absenceHours !== null && absenceHours >= engagementConfig.productive_absence.min_absence_hours) {
    const sched = await scheduledFor(db, p, localParts(now, p.timezone).date, await followupSettings(db, p.id), weekStart);
    const ended = sched.filter((s) => s.endsAt.getTime() <= now.getTime());
    const { data: fdone } = await db.from("planner_followups").select("item_id").eq("profile_id", p.id).eq("status", "done").gte("answered_at", new Date(now.getTime() - absenceHours * 3600000).toISOString());
    returnFlow = { absenceHours: Math.round(absenceHours), scheduledCount: ended.length, doneCount: (fdone ?? []).length };
  }
  return { facts, followups: { items: followups.items, presentation: followups.presentation }, next, soon, training, dndActive: Boolean(dnd?.length), returnFlow, supportBand, weekStart };
}
