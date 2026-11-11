import Link from "next/link";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { effective } from "@/modules/settings";
import { loadLife } from "@/modules/lifelog/service";
import { isStale, refreshDue, LIFE_FIELDS } from "@/modules/lifelog/rules";
import { LifeLogEditor, RefreshPrompt, OwnSituation } from "@/modules/lifelog/components/life-log-editor";
import { Button } from "@/shared/ui";
import content from "@content/life_log.ar.json";

/** P53 «سجل حياتي» (0.5 أ.9): عرض وتعديل وحذف، وآخر تأكيد لكل عنصر. */
export default async function LifeLogPage() {
  const s = (await getSession())!;
  const p = s.profile!;
  const db = await createClient();
  const [row, every] = await Promise.all([loadLife(db, p.id), effective<number>(db, p.id, "life_refresh_days")]);
  const now = new Date();
  const staleIds = LIFE_FIELDS.flatMap((f) => row.log[f]).filter((x) => isStale(x, now)).map((x) => x.id);
  const due = refreshDue({ intakeStatus: row.intake_status, intakeCompletedAt: row.intake_completed_at, lastRefreshAt: row.last_refresh_at, everyDays: every.value, now });
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{content.title}</h2>
      {row.intake_status !== "done" && <Button asChild size="sm"><Link href="/onboarding/life">{row.intake_status === "not_started" ? content.log.start_intake : content.log.continue_intake}</Link></Button>}
      {due && <RefreshPrompt profileId={p.id} />}
      <LifeLogEditor profileId={p.id} log={row.log} staleIds={staleIds} />
      <OwnSituation />
    </div>
  );
}
