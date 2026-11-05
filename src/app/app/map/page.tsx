import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { buildMapView } from "@/modules/capabilities/queries";
import { CapabilityMap } from "@/modules/capabilities/components/capability-map";
import { t } from "@/shared/i18n";
import type { AgeMode } from "@/shared/config";

/** P12 خريطة قدراتي (MAP-1..4). */
export default async function MapPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const view = await buildMapView(db, s.profile!.id, s.profile!.age_mode as AgeMode);
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{t("map.title")}</h2><CapabilityMap view={view} /></div>;
}
