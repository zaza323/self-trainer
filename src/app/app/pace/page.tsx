import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { latestBaselines, activeIncrements } from "@/modules/pace/service";
import { metricLabel, formatValue, compareLine, incrementText, paceContent as c } from "@/modules/pace/labels";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import type { AgeMode } from "@/shared/config";

/** P47 وتيرتي (ح.6): «أنت قبل شهر» مقابل «أنت اليوم» لكل مؤشر. بلا أي مقارنة بالآخرين، والانخفاض بلغة محايدة. */
export default async function PacePage() {
  const s = (await getSession())!;
  const p = s.profile!;
  const db = await createClient();
  const [{ now, monthAgo }, actives, { data: habits }, { data: ach }] = await Promise.all([
    latestBaselines(db, p.id), activeIncrements(db, p.id),
    db.from("planner_habits").select("id, title").eq("profile_id", p.id),
    db.from("profile_achievements").select("achievement_id, achievements!inner(code)").eq("profile_id", p.id).eq("achievements.code", "pace_rising").limit(1),
  ]);
  const titles = Object.fromEntries(((habits ?? []) as Array<{ id: string; title: string }>).map((h) => [h.id, h.title]));
  const metrics = Object.keys(now);
  const max = (m: string) => Math.max(now[m] ?? 0, monthAgo[m] ?? 0) || 1;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{c.title}</h2>{(ach ?? []).length > 0 && <Badge variant="success">{c.pace_rising}</Badge>}</div>
      <p className="text-sm text-muted-foreground">{c.intro}</p>
      {actives.map((a) => <Alert key={a.id} variant="info" className="text-sm">{incrementText(a, p.age_mode as AgeMode, titles)}</Alert>)}
      {!metrics.length ? <Alert>{c.no_baseline}</Alert> : (
        <ul className="space-y-3" data-testid="pace-metrics">
          {metrics.map((m) => (
            <li key={m}><Card><CardHeader className="pb-2"><CardTitle className="text-sm">{metricLabel(m, titles)}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
              {[{ k: c.then, v: monthAgo[m] ?? null, cls: "bg-muted-foreground/40" }, { k: c.now, v: now[m] ?? null, cls: "bg-primary" }].map((row) => (
                <div key={row.k} className="flex items-center gap-2"><span className="w-16 text-xs text-muted-foreground">{row.k}</span>
                  <div className="h-2 flex-1 rounded-full bg-muted"><div className={`h-2 rounded-full ${row.cls}`} style={{ width: `${row.v === null ? 0 : Math.round((row.v / max(m)) * 100)}%` }} /></div>
                  <span dir="ltr" className="w-12 text-xs">{formatValue(m, row.v)}</span></div>
              ))}
              {compareLine(m, monthAgo[m] ?? null, now[m] ?? null) && <p>{compareLine(m, monthAgo[m] ?? null, now[m] ?? null)}</p>}
            </CardContent></Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}
