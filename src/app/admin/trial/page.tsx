import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { AppShell } from "@/shared/ui/app-shell";
import { activeCohort, readiness } from "@/modules/trial/service";
import { TrialAdmin, type Snapshot } from "@/modules/trial/components/trial-admin";
import { ADMIN_NAV, logAdminAccess } from "../nav";
import content from "@content/trial.ar.json";

/** A08 التجربة المغلقة (المرحلة 8). */
export default async function AdminTrialPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.isAdmin) redirect("/");
  const db = await createClient();
  await logAdminAccess(db, "/admin/trial");
  const cohort = await activeCohort(db);
  const { data: parts } = cohort ? await db.from("trial_participants").select("age_mode_at_join").eq("cohort_id", cohort.id) : { data: [] };
  const byMode: Record<string, number> = {};
  for (const p of (parts ?? []) as Array<{ age_mode_at_join: string }>) byMode[p.age_mode_at_join] = (byMode[p.age_mode_at_join] ?? 0) + 1;
  const { data: snaps } = cohort ? await db.from("trial_metric_snapshots").select("week, metrics, warnings, participants, computed_at").eq("cohort_id", cohort.id).order("week", { ascending: false }) : { data: [] };
  const snapshots = (snaps ?? []) as Snapshot[];
  return (
    <AppShell title={content.admin.title} nav={ADMIN_NAV} user={{ name: s.profile?.display_name ?? s.email ?? "مشرف", badge: "مشرف" }}>
      <TrialAdmin cohort={cohort} byMode={byMode} participants={(parts ?? []).length} latest={snapshots[0] ?? null} snapshots={snapshots} readiness={await readiness(db)} />
    </AppShell>
  );
}
