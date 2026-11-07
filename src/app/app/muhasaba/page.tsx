import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { effective } from "@/modules/settings";
import { startMuhasaba } from "@/modules/muhasaba/service";
import { isMirrorWeek } from "@/modules/mirror/service";
import { mirrorConfig } from "@/modules/mirror/reconstruct";
import { todayIn } from "@/modules/missions/queries";
import { MuhasabaFlow } from "@/modules/muhasaba/components/muhasaba-flow";
import type { WeekStart } from "@/modules/planner/recurrence";
import type { AgeMode } from "@/shared/config";
import content from "@content/muhasaba.ar.json";

/** P46 محاسبة النفس (ز). */
export default async function MuhasabaPage() {
  const s = (await getSession())!;
  const p = { id: s.profile!.id, user_id: s.userId, age_mode: s.profile!.age_mode as AgeMode, timezone: s.profile!.timezone };
  const db = await createClient();
  const weekStart = (await effective<WeekStart>(db, p.id, "week_start_day")).value;
  const view = await startMuhasaba(db, p, new Date(), weekStart);
  const replacedStep = (await isMirrorWeek(db, p.id, todayIn(p.timezone))) ? mirrorConfig.mirror_week.replaces_muhasaba_step : null;
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.title}</h2><p className="text-sm text-muted-foreground">{content.intro[p.age_mode]}</p><MuhasabaFlow view={view} ageMode={p.age_mode} alreadyDone={view.entry.completed} replacedStep={replacedStep} /></div>;
}
