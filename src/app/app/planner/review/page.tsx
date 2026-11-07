import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadPlannerContext } from "@/modules/planner/context";
import { getOrCreateReview } from "@/modules/planner/review-service";
import { recurringShortfalls } from "@/modules/muhasaba/flow";
import { ReviewFlow } from "@/modules/planner/components/phase10-panels";
import content from "@content/planner.ar.json";

/** P32 المراجعة الأسبوعية الموجّهة (ب.9) + ز.4 التقصير المتكرر. */
export default async function ReviewPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const ctx = await loadPlannerContext(db, s.profile!);
  const review = await getOrCreateReview(db, s.profile!.id, ctx.today, ctx.weekStart);
  const { data: entries } = await db.from("muhasaba_entries").select("local_date, shortfalls").eq("profile_id", s.profile!.id).order("local_date", { ascending: false }).limit(20);
  const rec = recurringShortfalls((entries ?? []) as Array<{ local_date: string; shortfalls: Array<{ text: string; reason: string | null; task_id: string | null }> }>, ctx.today);
  const { data: titles } = rec.length ? await db.from("planner_tasks").select("id, title").in("id", rec.map((r) => r.key).filter((k) => /^[0-9a-f-]{36}$/.test(k))) : { data: [] };
  const names = rec.map((r) => ((titles ?? []) as Array<{ id: string; title: string }>).find((t) => t.id === r.key)?.title ?? r.key);
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.review.title}</h2><ReviewFlow review={review} recurring={names} /></div>;
}
