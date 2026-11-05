import Link from "next/link";
import { getLinkedPlayers } from "@/modules/accounts";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import { t } from "@/shared/i18n";
import explainers from "@content/explainers.ar.json";
import { GUARDIAN_PERMISSIONS } from "@/shared/config/permissions";

/** G02: اللوحة مع التنقل بين المتدربين (ACC-4). */
export default async function GuardianDashboard() {
  const players = await getLinkedPlayers();
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("guardian.players")}</h2>
      {players.length === 0 && <Alert>{explainers.guardian_empty_dashboard}</Alert>}
      {players.map(({ link, player }) => (
        <Card key={link.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{player.display_name}</CardTitle>
              <div className="flex gap-1"><Badge variant="secondary">{t(`modes.${player.age_mode}`)}</Badge><Badge variant="outline">{t(`relations.${link.relation}`)}</Badge>{link.is_creator && <Badge>{t("guardians.creator")}</Badge>}</div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {GUARDIAN_PERMISSIONS.filter((p) => link.permissions[p]).map((p) => <Badge key={p} variant="muted">{t(`permissions.${p}`)}</Badge>)}
            </div>
            <Button asChild size="sm"><Link href={`/guardian/${player.id}`}>{t("guardian.overview")}</Link></Button>
          </CardContent>
        </Card>
      ))}
      <div className="flex gap-2">
        <Button asChild variant="outline"><Link href="/guardian/children/new">{t("guardian.new_child")}</Link></Button>
        <Button asChild variant="outline"><Link href="/invite">{t("guardians.accept_title")}</Link></Button>
      </div>
    </div>
  );
}
