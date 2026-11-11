import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { aiEnabled } from "@/modules/companion";
import { loadLife } from "@/modules/lifelog/service";
import { isStale, LIFE_FIELDS, type LifeField } from "@/modules/lifelog/rules";
import { IntakeJourney } from "@/modules/lifelog/components/intake-journey";
import content from "@content/life_log.ar.json";

/** P52 رحلة التعارف (0.5 أ.3): أول ما يراه المستخدم بعد اختيار الوضع، وقبل الغاية ومرآة الواقع. */
export default async function LifeIntakePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.profile) redirect("/onboarding");
  if (s.profile.kind !== "player") redirect("/guardian");
  const db = await createClient();
  const [row, { data: pc }, { data: sug }] = await Promise.all([
    loadLife(db, s.profile.id),
    db.from("personal_context").select("routine").eq("profile_id", s.profile.id).maybeSingle(),
    db.from("context_suggestions").select("id, field, value").eq("profile_id", s.profile.id).eq("status", "pending").in("field", [...LIFE_FIELDS]),
  ]);
  const now = new Date();
  const staleIds = LIFE_FIELDS.flatMap((f) => row.log[f]).filter((x) => isStale(x, now)).map((x) => x.id);
  return (
    <main className="mx-auto max-w-xl space-y-3 p-4 py-8">
      <h1 className="text-lg font-semibold">{content.intake.title}</h1>
      <p className="text-sm text-muted-foreground">{content.intake.intro}</p>
      <IntakeJourney profileId={s.profile.id} log={row.log} step={row.intake_step} routine={((pc?.routine as string[] | undefined) ?? [])} staleIds={staleIds} aiAvailable={aiEnabled()} next={next === "path" || next === "context" ? next : ""}
        pending={((sug ?? []) as Array<{ id: string; field: LifeField; value: string }>).map((x) => ({ id: x.id, field: x.field, text: x.value }))} />
    </main>
  );
}
