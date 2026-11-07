import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { hasTool } from "@/modules/planner/tiers";
import { listTasks } from "@/modules/planner/service";
import { listHabits } from "@/modules/planner/habits-service";
import { focusSessionsOn } from "@/modules/planner/focus-service";
import { weeklyCompletionRate, productiveHours, mostPostponed, estimateAccuracy } from "@/modules/planner/stats";
import { weekStartOf } from "@/modules/planner/habits";
import { addDays } from "@/modules/planner/recurrence";
import { instantForLocal } from "@/modules/notifications/plan";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/planner.ar.json";

/** P31 الإحصائيات (المستوى 2): قارن نفسك بنفسك. */
export default async function StatsPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  if (!hasTool(ctx.tier.tier, "stats")) return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.stats.title}</h2><Alert>{content.stats.locked}</Alert></div>;
  const ws = weekStartOf(ctx.today, ctx.weekStart);
  const [tasks, habits, focus] = await Promise.all([listTasks(db, s.profile!.id), listHabits(db, s.profile!.id, ctx.today, ctx.weekStart), focusSessionsOn(db, s.profile!.id, instantForLocal(ws, "00:00", ctx.tz).toISOString(), instantForLocal(addDays(ws, 7), "00:00", ctx.tz).toISOString())]);
  const rate = weeklyCompletionRate(tasks, ws);
  const hours = productiveHours(tasks, focus, ctx.tz);
  const postponed = mostPostponed(tasks);
  const acc = estimateAccuracy(tasks, (d) => weekStartOf(d, ctx.weekStart));
  const Box = ({ title, children }: { title: string; children: React.ReactNode }) => <Card><CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="text-sm">{children}</CardContent></Card>;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{content.stats.title}</h2>
      <p className="text-xs text-muted-foreground">{content.stats.no_comparison}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Box title={content.stats.completion}><span dir="ltr">{Math.round(rate * 100)}%</span></Box>
        <Box title={content.stats.focus_minutes}><span dir="ltr">{focus.reduce((a, f) => a + f.minutes, 0)}</span></Box>
        <Box title={content.stats.productive_hours}>{hours.length ? hours.map((h) => <span key={h.hour} dir="ltr" className="me-2">{String(h.hour).padStart(2, "0")}:00</span>) : "—"}</Box>
        <Box title={content.stats.most_postponed}>{postponed.length ? <ul>{postponed.map((p) => <li key={p.id}>{p.title} ({p.postpone_count})</li>)}</ul> : "—"}</Box>
        <Box title={content.stats.estimate_accuracy}>{acc.length ? <ul>{acc.map((a) => <li key={a.week}><span dir="ltr">{a.week}</span>: <span dir="ltr">{Math.round(a.mean_rel_error * 100)}%</span> (n={a.n})</li>)}</ul> : "—"}</Box>
        <Box title={content.stats.habit_adherence}>{habits.length ? <ul>{habits.map((h) => <li key={h.id}>{h.title}: <span dir="ltr">{Math.round(h.adherence * 100)}%</span></li>)}</ul> : "—"}</Box>
      </div>
    </div>
  );
}
