import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { effective } from "@/modules/settings";
import { todayIn } from "@/modules/missions/queries";
import { addDays } from "@/modules/planner/recurrence";
import { getOrCreateReconstruction, categoriesFor } from "@/modules/mirror/service";
import { mirrorConfig } from "@/modules/mirror/reconstruct";
import { ReconstructEditor } from "@/modules/mirror/components/reconstruct-editor";
import type { AgeMode } from "@/shared/config";
import content from "@content/mirror.ar.json";

/** P48 إعادة بناء اليوم (الشق اليدوي). */
export default async function ReconstructPage({ searchParams }: { searchParams: Promise<{ date?: string; source?: string }> }) {
  const sp = await searchParams;
  const s = (await getSession())!;
  const p = { id: s.profile!.id, age_mode: s.profile!.age_mode as AgeMode, timezone: s.profile!.timezone };
  const db = await createClient();
  const today = todayIn(p.timezone);
  const date = sp.date === "yesterday" ? addDays(today, -1) : sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const source = sp.source === "onboarding" ? "onboarding" : sp.source === "muhasaba" ? "muhasaba" : "manual";
  const [r, categories, days] = await Promise.all([getOrCreateReconstruction(db, p, { date, source, now: new Date() }), categoriesFor(db, p.id), effective<number>(db, p.id, "mirror_days_required")]);
  const { data: recent } = await db.from("day_reconstructions").select("id").eq("profile_id", p.id).eq("completed", true).gte("local_date", addDays(today, -7));
  const mirrorWeek = (recent ?? []).length > 0 && (recent ?? []).length < days.value;
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.reconstruct.title}</h2><ReconstructEditor reconstructionId={r.rec.id} date={date} blocks={r.blocks} gaps={r.gaps} categories={categories} tz={p.timezone} completed={r.rec.completed} mirrorWeek={mirrorWeek} energyMinBlock={mirrorConfig.reconstruction.energy_question_min_block_minutes} /></div>;
}
