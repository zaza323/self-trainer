import Link from "next/link";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { latestMirror } from "@/modules/mirror/service";
import { Alert, Button } from "@/shared/ui";
import { MirrorSuggestionCard } from "@/modules/mirror/components/suggestion-card";
import content from "@content/mirror.ar.json";

/** مرآتي: آخر مرآة أو البدء بإعادة بناء يوم. */
export default async function MirrorHome() {
  const s = (await getSession())!;
  const db = await createClient();
  const latest = await latestMirror(db, s.profile!.id);
  const { data: sug } = await db.from("mirror_suggestions").select("id, reason").eq("profile_id", s.profile!.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1);
  const pending = ((sug ?? [])[0] as { id: string; reason: string } | undefined) ?? null;
  const { data: recs } = await db.from("day_reconstructions").select("local_date, completed").eq("profile_id", s.profile!.id).order("local_date", { ascending: false }).limit(7);
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{content.title}</h2>
      <p className="text-sm text-muted-foreground">{content.onboarding.privacy}</p>
      {pending && <MirrorSuggestionCard id={pending.id} reason={pending.reason} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" asChild><Link href="/app/mirror/reconstruct?date=today">{content.reconstruct.title}: {content.home.today}</Link></Button>
        <Button size="sm" variant="outline" asChild><Link href="/app/mirror/reconstruct?date=yesterday">{content.reconstruct.title}: {content.home.yesterday}</Link></Button>
        {(recs ?? []).some((r) => r.completed) && <Button size="sm" variant="outline" asChild><Link href="/app/mirror/predict">{content.predict.title}</Link></Button>}
        {latest && <Button size="sm" variant="ghost" asChild><Link href={`/app/mirror/${latest.id}`}>{content.mirror_title}</Link></Button>}
      </div>
      {!(recs ?? []).length && <Alert className="text-sm">{content.no_data}</Alert>}
      <ul className="text-sm text-muted-foreground">{((recs ?? []) as Array<{ local_date: string; completed: boolean }>).map((r) => <li key={r.local_date}><Link className="underline" href={`/app/mirror/reconstruct?date=${r.local_date}`}>{r.local_date}</Link> {r.completed ? "✓" : ""}</li>)}</ul>
    </div>
  );
}
