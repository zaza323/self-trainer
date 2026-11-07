import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { effective } from "@/modules/settings";
import { buildMirror } from "@/modules/mirror/service";
import { predictAndMirrorAction } from "@/modules/mirror/actions";
import { Alert, Button, Input, Label } from "@/shared/ui";
import content from "@content/mirror.ar.json";
import cats from "@content/reconstruction_categories.ar.json";
import type { AgeMode } from "@/shared/config";

/** P49 التوقّع قبل المرآة (ط.4): 3 فئات بمنزلقات بالساعات. */
export default async function PredictPage() {
  const s = (await getSession())!;
  const p = { id: s.profile!.id, age_mode: s.profile!.age_mode as AgeMode, timezone: s.profile!.timezone };
  const db = await createClient();
  const days = (await effective<number>(db, p.id, "mirror_days_required")).value;
  const m = await buildMirror(db, p, { days, now: new Date() });
  if (!m) return <Alert>{content.no_data}</Alert>;
  const label = (k: string) => (cats.labels as Record<string, string>)[k] ?? k;
  async function act(fd: FormData) { "use server"; await predictAndMirrorAction(null, fd); }
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{content.predict.title}</h2>
      <p className="text-sm text-muted-foreground">{content.predict.intro}</p>
      <form action={act} className="space-y-3" data-testid="predict-form">
        {m.predictionCategories.map((c) => <div key={c}><Label htmlFor={`h-${c}`}>{label(c)} ({content.predict.hours})</Label><input type="hidden" name="category" value={c} /><Input id={`h-${c}`} name="hours" type="range" min={0} max={12} step={0.5} defaultValue={1} dir="ltr" /></div>)}
        <Button type="submit">{content.predict.submit}</Button>
      </form>
    </div>
  );
}
