import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { AppShell } from "@/shared/ui/app-shell";
import { ADMIN_NAV, logAdminAccess } from "../nav";
import { TemplateMetricsTable, DraftsQueue, type MetricRow, type DraftRow } from "@/modules/adaptation/components/templates-admin";
import { textByMode } from "@/modules/library";

/** A03 فعالية القوالب (ADMIN-4) + A04 طابور مسودات الذكاء الاصطناعي (ADMIN-5). */
export default async function AdminTemplatesPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.isAdmin) redirect("/");
  const db = await createClient();
  await logAdminAccess(db, "/admin/templates");
  const [{ data: metrics }, { data: reviews }] = await Promise.all([
    db.from("template_metrics").select("*").order("flagged", { ascending: false }).order("missions_n", { ascending: false }),
    db.from("template_draft_reviews").select("*").order("created_at", { ascending: false }).limit(30),
  ]);
  const rs = (reviews ?? []) as Array<{ template_id: string; template_version: number; source_version: number; rationale: string | null; status: string; created_at: string }>;
  const { data: tpls } = rs.length ? await db.from("mission_templates").select("id, version, title_by_mode, situation_by_mode").in("id", rs.map((r) => r.template_id)) : { data: [] };
  const byKey = new Map(((tpls ?? []) as Array<{ id: string; version: number; title_by_mode: unknown; situation_by_mode: unknown }>).map((t) => [`${t.id}:${t.version}`, t]));
  const drafts: DraftRow[] = rs.map((r) => { const t = byKey.get(`${r.template_id}:${r.template_version}`); return { ...r, title: t ? textByMode(t.title_by_mode as Parameters<typeof textByMode>[0], "adult") : "", situation: t ? textByMode(t.situation_by_mode as Parameters<typeof textByMode>[0], "adult") : "" }; });
  return (
    <AppShell title="لوحة المشرف" nav={ADMIN_NAV} user={{ name: s.profile?.display_name ?? s.email ?? "مشرف", badge: "مشرف" }}>
      <div className="space-y-4"><TemplateMetricsTable rows={(metrics ?? []) as MetricRow[]} /><DraftsQueue drafts={drafts} /></div>
    </AppShell>
  );
}
