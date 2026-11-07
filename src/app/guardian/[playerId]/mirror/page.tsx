import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { Alert, Card, CardContent } from "@/shared/ui";
import content from "@content/mirror.ar.json";
import cats from "@content/reconstruction_categories.ar.json";

/** G16 المرآة المجمّعة للمربي (ط.9): توزيع الفئات فقط، بلا مقاطع ولا تسميات (RLS تمنع time_blocks_actual). */
export default async function GuardianMirrorPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link) notFound();
  if (!(link.is_creator || link.permissions.view_planner)) return <Alert>{content.guardian.intro}</Alert>;
  const db = await createClient();
  const { data } = await db.from("mirror_reports").select("distribution, days_count, period_start, period_end").eq("profile_id", playerId).order("created_at", { ascending: false }).limit(1);
  const r = (data ?? [])[0] as { distribution: Record<string, number>; days_count: number; period_start: string; period_end: string } | undefined;
  const label = (k: string) => (cats.labels as Record<string, string>)[k] ?? k;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{content.guardian.title} — {player.display_name}</h2>
      <p className="text-sm text-muted-foreground">{content.guardian.intro}</p>
      {!r ? <Alert>{content.no_data}</Alert> : <Card><CardContent className="p-4 text-sm"><p className="text-xs text-muted-foreground">{r.period_start} → {r.period_end}</p><ul>{Object.entries(r.distribution).sort((a, b) => b[1] - a[1]).map(([k, m]) => <li key={k}>{label(k)}: <span dir="ltr">{(m / 60).toFixed(1)}</span> {content.columns.hours}</li>)}</ul></CardContent></Card>}
    </div>
  );
}
