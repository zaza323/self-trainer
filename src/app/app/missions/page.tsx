import Link from "next/link";
import { getSession } from "@/modules/accounts";
import { listMissions } from "@/modules/missions";
import { loadActiveTemplates, textByMode } from "@/modules/library";
import { createClient } from "@/shared/db/server";
import { Badge, Card, CardContent } from "@/shared/ui";
import { t } from "@/shared/i18n";
import type { AgeMode } from "@/shared/config";

export default async function MissionsHistoryPage() {
  const s = (await getSession())!;
  const mode = s.profile!.age_mode as AgeMode;
  const db = await createClient();
  const [missions, templates] = await Promise.all([listMissions(s.profile!.id, { limit: 50 }), loadActiveTemplates(db)]);
  const byId = new Map(templates.map((x) => [x.id, x]));
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t("missions.history")}</h2>
      {missions.filter((m) => !m.dismissed).map((m) => (
        <Card key={m.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
          <Link href={`/app/missions/${m.id}`} className="font-medium underline-offset-2 hover:underline">{textByMode(byId.get(m.template_id)?.title, mode) || m.template_id}</Link>
          <div className="flex gap-1"><Badge variant="muted">{m.suggested_for}</Badge><Badge variant={m.status === "reflected" ? "success" : "secondary"}>{t(`missions.status.${m.status}`)}</Badge>{m.gate1 !== null && <Badge variant={m.gate1 ? "success" : "warning"}>{m.gate1 ? t("missions.gate1_pass") : t("missions.gate1_fail")}</Badge>}</div>
        </CardContent></Card>
      ))}
    </div>
  );
}
