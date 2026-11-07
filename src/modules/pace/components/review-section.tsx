import "server-only";
/** P32 قسم «زيادتك» (ح.5): نتيجة زيادة الأسبوع ثم اقتراح واحد. الأرقام من الخادم؛ النموذج يصوغ فقط (weekly_review). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/shared/db/admin";
import { aiEnabled, anthropicCaller } from "@/modules/companion";
import { weeklyReviewWording } from "@/modules/planner/ai";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import type { AgeMode } from "@/shared/config";
import { runWeeklyPace, capContext, type IncrementRow } from "../service";
import { localParts } from "@/modules/notifications/plan";
import { incrementText, lastIncrementLine, paceContent as c } from "../labels";
import { IncrementDecision } from "./increment-card";

const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };

export async function PaceReviewSection({ db, profile }: { db: SupabaseClient; profile: { id: string; age_mode: AgeMode; timezone: string } }) {
  const admin = adminOrNull();
  if (admin) { try { await runWeeklyPace(admin, profile); } catch { /* الدورة تُعاد في cron؛ لا نكسر المراجعة */ } }
  const [{ data: last }, { data: pending }, { data: habits }] = await Promise.all([
    db.from("growth_increments").select("*").eq("profile_id", profile.id).in("status", ["achieved", "held", "stepped_back"]).neq("kind", "reallocate").order("week_start", { ascending: false }).limit(1),
    db.from("growth_increments").select("*").eq("profile_id", profile.id).eq("status", "proposed").order("created_at", { ascending: false }).limit(2),
    db.from("planner_habits").select("id, title").eq("profile_id", profile.id),
  ]);
  const titles = Object.fromEntries(((habits ?? []) as Array<{ id: string; title: string }>).map((h) => [h.id, h.title]));
  const l = ((last ?? [])[0] as IncrementRow | undefined) ?? null;
  const fallbackLine = l ? `${lastIncrementLine(l, profile.age_mode, titles)} ${(c.review.outcome as Record<string, string>)[l.status] ?? ""}` : null;
  let intro = fallbackLine;
  if (fallbackLine && admin && aiEnabled()) {
    const w = await weeklyReviewWording({ db: admin, caller: anthropicCaller(), profileId: profile.id, mode: profile.age_mode, facts: fallbackLine, fallback: { intro: fallbackLine, incrementLine: null } });
    intro = w.intro;
  }
  const props = (pending ?? []) as IncrementRow[];
  const cap = await capContext(admin ?? db, profile, localParts(new Date(), profile.timezone).date);
  return (
    <Card data-testid="pace-review">
      <CardHeader><CardTitle className="text-base">{c.review.section_title}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {intro && <p>{intro}</p>}
        {props.length ? <><p className="text-muted-foreground">{c.review.next}</p>{props.map((p) => (
          <IncrementDecision key={p.id} id={p.id} text={incrementText(p, profile.age_mode, titles)} canDecide={!p.requires_guardian} waitingGuardian={p.requires_guardian} editable={p.target_value !== null} discovery={cap.discovery} />
        ))}</> : <p className="text-muted-foreground">{c.review.none}</p>}
      </CardContent>
    </Card>
  );
}
