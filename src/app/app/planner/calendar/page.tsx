import Link from "next/link";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { hasTool } from "@/modules/planner/tiers";
import { listTasks } from "@/modules/planner/service";
import { blocksBetween } from "@/modules/planner/blocks-service";
import { addDays } from "@/modules/planner/recurrence";
import { weekStartOf } from "@/modules/planner/habits";
import { instantForLocal } from "@/modules/notifications/plan";
import { CalendarView } from "@/modules/planner/components/phase10-panels";
import { Alert } from "@/shared/ui";
import content from "@content/planner.ar.json";

/** P26 التقويم (يوم/أسبوع/شهر) + Time Blocking (المستوى 2). */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const sp = await searchParams;
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  if (!hasTool(ctx.tier.tier, "calendar")) return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.calendar.title}</h2><Alert>{content.calendar.locked}</Alert></div>;
  const view = (sp.view === "week" || sp.view === "month" ? sp.view : "day") as "day" | "week" | "month";
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : ctx.today;
  const start = view === "day" ? anchor : view === "week" ? weekStartOf(anchor, ctx.weekStart) : `${anchor.slice(0, 7)}-01`;
  const n = view === "day" ? 1 : view === "week" ? 7 : 31;
  const days = Array.from({ length: n }, (_, i) => addDays(start, i)).filter((d) => view !== "month" || d.slice(0, 7) === anchor.slice(0, 7));
  const [tasks, blocks] = await Promise.all([listTasks(db, s.profile!.id), blocksBetween(db, s.profile!.id, instantForLocal(days[0]!, "00:00", ctx.tz).toISOString(), instantForLocal(addDays(days[days.length - 1]!, 1), "00:00", ctx.tz).toISOString())]);
  const nav = (d: string) => `/app/planner/calendar?view=${view}&date=${d}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{content.calendar.title}</h2>
        {(["day", "week", "month"] as const).map((v) => <Link key={v} href={`/app/planner/calendar?view=${v}&date=${anchor}`} className={`rounded-full border px-3 py-1 text-sm ${v === view ? "bg-primary text-primary-foreground" : ""}`}>{content.calendar[v]}</Link>)}
        <Link href={nav(addDays(anchor, -n))} className="text-sm underline">{content.calendar.prev}</Link><Link href={nav(addDays(anchor, n))} className="text-sm underline">{content.calendar.next}</Link></div>
      <CalendarView days={days} tasks={tasks} blocks={blocks} tz={ctx.tz} canBlock={hasTool(ctx.tier.tier, "time_blocking")} view={view} />
    </div>
  );
}
