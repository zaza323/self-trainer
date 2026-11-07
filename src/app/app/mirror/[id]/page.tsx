import { notFound } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { MirrorReport } from "@/modules/mirror/components/mirror-report";
import type { MirrorReportRow } from "@/modules/mirror/service";
import { compareDistributions } from "@/modules/mirror/suggest";
import { mirrorConfig } from "@/modules/mirror/reconstruct";
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
  const report = data as MirrorReportRow;
  const { data: prev } = report.follow_up_of ? await db.from("mirror_reports").select("distribution, days_count").eq("id", report.follow_up_of).maybeSingle() : { data: null };
  // ط.6-5: مقارنة الواقع بالواقع (متوسط دقائق يوميًا ⇒ ساعات)
  const perDay = (d: Record<string, number>, n: number) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v / Math.max(1, n)]));
  const followUp = prev ? compareDistributions(perDay((prev as { distribution: Record<string, number> }).distribution, (prev as { days_count: number }).days_count), perDay(report.distribution, report.days_count), mirrorConfig.mirror.patterns.max) : null;
  return <MirrorReport report={report} supportBand={SUPPORT_LEVELS.indexOf(lvl) >= 2 ? "L2_L3" : "L0_L1"} followUp={followUp} />;
}
