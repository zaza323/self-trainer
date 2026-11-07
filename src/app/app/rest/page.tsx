import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { restSuggestionsFor } from "@/modules/rest/service";
import { RestList } from "@/modules/rest/components/rest-list";
import type { AgeMode } from "@/shared/config";
import content from "@content/rest_activities.ar.json";

/** P41 قائمة الراحة المجدِّدة (هـ). */
export default async function RestPage({ searchParams }: { searchParams: Promise<{ source?: string; gap?: string; break?: string }> }) {
  const sp = await searchParams;
  const s = (await getSession())!;
  const p = { id: s.profile!.id, age_mode: s.profile!.age_mode as AgeMode, timezone: s.profile!.timezone };
  const db = await createClient();
  const source = (["next", "free_gap", "pomodoro", "priorities_done", "wind_down", "manual"].includes(sp.source ?? "") ? sp.source : "manual") as "next" | "free_gap" | "pomodoro" | "priorities_done" | "wind_down" | "manual";
  const gap = sp.gap ? Number(sp.gap) : null;
  const r = await restSuggestionsFor(db, p, new Date(), { source, gapMin: Number.isFinite(gap) && gap ? gap : null, pomodoroBreak: sp.break === "long" ? "long" : sp.break === "short" ? "short" : null });
  const { data: outcomes } = await db.from("rest_outcomes").select("activity_key, uses, felt_more_count").eq("profile_id", p.id);
  const out: Record<string, { uses: number; felt_more_count: number }> = {};
  for (const o of (outcomes ?? []) as Array<{ activity_key: string; uses: number; felt_more_count: number }>) out[o.activity_key] = { uses: o.uses, felt_more_count: o.felt_more_count };
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.title}</h2><RestList shown={r.shown} more={r.more} ageMode={p.age_mode} source={source} firstUse={r.firstUse} windDown={r.windDown} outcomes={out} /></div>;
}
