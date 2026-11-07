import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { incrementText, paceContent as c } from "@/modules/pace/labels";
import { IncrementDecision } from "@/modules/pace/components/increment-card";
import { Alert, Card, CardContent } from "@/shared/ui";
import type { AgeMode } from "@/shared/config";

/** G15 موافقة المربي على زيادة الطفل (ح.5-3): الزيادة لا تُفعّل قبل موافقة صاحب manage_settings. */
export default async function GuardianPacePage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link) notFound();
  const canDecide = link.is_creator || link.permissions.manage_settings;
  const db = await createClient();
  const [{ data }, { data: habits }] = await Promise.all([
    db.from("growth_increments").select("*").eq("profile_id", playerId).eq("status", "proposed").eq("requires_guardian", true).order("created_at", { ascending: false }),
    db.from("planner_habits").select("id, title").eq("profile_id", playerId),
  ]);
  const titles = Object.fromEntries(((habits ?? []) as Array<{ id: string; title: string }>).map((h) => [h.id, h.title]));
  const rows = (data ?? []) as Array<{ id: string; kind: string; metric: string | null; from_value: number | null; target_value: number | null; description: string | null }>;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{c.guardian.title} — {player.display_name}</h2>
      <p className="text-sm text-muted-foreground">{c.guardian.intro}</p>
      {!rows.length ? <Alert>{c.guardian.none}</Alert> : rows.map((r) => (
        <Card key={r.id}><CardContent className="p-4">
          <IncrementDecision id={r.id} text={incrementText(r, player.age_mode as AgeMode, titles)} canDecide={canDecide} waitingGuardian={false} editable={r.target_value !== null} guardian />
        </CardContent></Card>
      ))}
    </div>
  );
}
