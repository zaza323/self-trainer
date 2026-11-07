import "server-only";
/** ط.2/ط.6-5: تقييم يومي لاقتراح أسبوع المرآة (الفجوة، الشهري، المتابعة) + إشعار داخل الميزانية. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { effective } from "@/modules/settings";
import { localParts } from "@/modules/notifications/plan";
import { addDays } from "@/modules/planner/recurrence";
import { recurringShortfalls } from "@/modules/muhasaba/flow";
import { mirrorSuggestionDue, mirrorTriggers, type PastSuggestion } from "./suggest";

type Db = SupabaseClient;
type P = { id: string; timezone: string };

/** متوسط follow_through لكل أسبوع من حالات التفاعل اليومية، الأحدث آخرًا. */
export function weeklyAverages(rows: Array<{ date: string; follow_through: number | null }>, today: string, weeks: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const from = addDays(today, -7 * (w + 1)), to = addDays(today, -7 * w);
    const vals = rows.filter((r) => r.date >= from && r.date < to && r.follow_through !== null).map((r) => Number(r.follow_through));
    out.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  }
  return out;
}

export async function evaluateMirrorSuggestion(admin: Db, p: P, now = new Date()): Promise<string | null> {
  const today = localParts(now, p.timezone).date;
  const g = mirrorTriggers.gap;
  const [gap, monthly, { data: states }, { data: entries }, { data: past }, { data: reports }] = await Promise.all([
    effective<boolean>(admin, p.id, "mirror_gap_suggestions"), effective<boolean>(admin, p.id, "mirror_monthly"),
    admin.from("engagement_states").select("date, follow_through").eq("profile_id", p.id).gte("date", addDays(today, -7 * g.weeks)),
    admin.from("muhasaba_entries").select("local_date, shortfalls").eq("profile_id", p.id).gte("local_date", addDays(today, -g.or_repeated_shortfall.days)),
    admin.from("mirror_suggestions").select("reason, status, created_at, decided_at, follow_up_of").eq("profile_id", p.id),
    admin.from("mirror_reports").select("id, created_at, chosen_change_text, follow_up_of").eq("profile_id", p.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const reps = (reports ?? []) as Array<{ id: string; created_at: string; chosen_change_text: string | null; follow_up_of: string | null }>;
  const followed = new Set(reps.map((r) => r.follow_up_of).filter(Boolean));
  const candidate = reps.find((r) => r.chosen_change_text && !followed.has(r.id));
  const due = mirrorSuggestionDue({
    today, gapEnabled: gap.value, monthlyEnabled: monthly.value,
    weeklyFollowThrough: weeklyAverages((states ?? []) as Array<{ date: string; follow_through: number | null }>, today, g.weeks),
    repeatedShortfall: recurringShortfalls((entries ?? []) as Parameters<typeof recurringShortfalls>[0], today).length > 0,
    past: (past ?? []) as PastSuggestion[], lastMirrorDate: reps[0]?.created_at.slice(0, 10) ?? null,
    followUpCandidate: candidate ? { id: candidate.id, date: candidate.created_at.slice(0, 10) } : null,
  });
  if (!due) return null;
  const { data, error } = await admin.from("mirror_suggestions").insert({ profile_id: p.id, reason: due.reason, follow_up_of: due.followUpOf ?? null }).select("id").single();
  if (error || !data) return null;
  await admin.from("notifications").upsert({ profile_id: p.id, type: "mirror_suggestion", dedupe_key: `mirror_suggestion:${data.id}`, payload: { reason: due.reason } }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  return due.reason;
}

export async function evaluateMirrorSuggestionsAll(admin: Db, now = new Date()): Promise<{ suggested: number }> {
  const { data } = await admin.from("profiles").select("id, timezone").eq("kind", "player");
  let suggested = 0;
  for (const p of (data ?? []) as P[]) if (await evaluateMirrorSuggestion(admin, p, now)) suggested++;
  return { suggested };
}
