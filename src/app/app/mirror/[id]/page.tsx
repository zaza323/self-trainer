import { notFound } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { MirrorReport } from "@/modules/mirror/components/mirror-report";
import type { MirrorReportRow } from "@/modules/mirror/service";
import { SUPPORT_LEVELS, support as supportCfg, type AgeMode, type SupportLevel } from "@/shared/config";

/** P50/P51 المرآة وتغيير واحد بوعي. */
export default async function MirrorReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
  const db = await createClient();
  const { data } = await db.from("mirror_reports").select("*").eq("id", id).maybeSingle();
  if (!data || data.profile_id !== s.profile!.id) notFound();
  const { data: st } = await db.from("capability_states").select("support_level").eq("profile_id", s.profile!.id).eq("capability_id", "planning").maybeSingle();
  const lvl: SupportLevel = ((st as { support_level: SupportLevel } | null)?.support_level) ?? supportCfg.initial_by_age_mode[s.profile!.age_mode as AgeMode];
  return <MirrorReport report={data as MirrorReportRow} supportBand={SUPPORT_LEVELS.indexOf(lvl) >= 2 ? "L2_L3" : "L0_L1"} />;
}
