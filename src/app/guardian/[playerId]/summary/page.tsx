import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createAdminClient } from "@/shared/db/admin";
import { createClient } from "@/shared/db/server";
import { anthropicCaller, weeklySummary } from "@/modules/companion";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import { t } from "@/shared/i18n";
import type { AgeMode } from "@/shared/config";

/** G10: الملخص الأسبوعي (GUARD-4) — السقوط ملخص رقمي بلا نص مولّد. */
export default async function WeeklySummaryPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link || (!link.is_creator && !link.permissions.view_progress)) notFound();
  const db = await createClient();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ data: missions }, { data: evidence }] = await Promise.all([
    db.from("missions").select("status, gate1, gate2, template_id").eq("profile_id", playerId).gte("created_at", since),
    db.from("evidence_events").select("capability_id, value, type").eq("profile_id", playerId).gte("created_at", since),
  ]);
  const ms = (missions ?? []) as Array<{ status: string; gate1: boolean | null; gate2: string | null }>;
  const ev = (evidence ?? []) as Array<{ capability_id: string; value: number; type: string }>;
  const byCap = new Map<string, number[]>();
  for (const e of ev) byCap.set(e.capability_id, [...(byCap.get(e.capability_id) ?? []), Number(e.value)]);
  const stats = { missions: ms.length, reflected: ms.filter((m) => m.status === "reflected").length, shown: ms.filter((m) => m.gate2 === "shown").length, partial: ms.filter((m) => m.gate2 === "partial").length, abandoned: ms.filter((m) => m.gate1 === false).length, capability_means: Object.fromEntries([...byCap].map(([k, v]) => [k, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100])) };
  let ai: { improved: string[]; needs_support: string[]; guardian_tip: string; source: "ai" | "fixed" } = { improved: [], needs_support: [], guardian_tip: "", source: "fixed" };
  try { ai = await weeklySummary({ db: createAdminClient(), caller: anthropicCaller(), profileId: playerId, mode: player.age_mode as AgeMode, stats }); } catch { /* بلا مفتاح خدمة */ }
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t("guardian.weekly")} — {player.display_name}</h2>
      <Card><CardHeader><CardTitle className="text-base">الأرقام</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <div>مهام: <strong>{stats.missions}</strong></div><div>متأمَّلة: <strong>{stats.reflected}</strong></div><div>ظهرت: <strong>{stats.shown}</strong></div><div>جزئيًا: <strong>{stats.partial}</strong></div><div>متروكة: <strong>{stats.abandoned}</strong></div>
      </CardContent></Card>
      {ai.source === "ai" ? (
        <Card><CardHeader><CardTitle className="text-base">ما لاحظه المرافق (ذكاء اصطناعي)</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          {ai.improved.length > 0 && <div><div className="font-medium">تحسّن</div><ul className="list-disc pe-5">{ai.improved.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {ai.needs_support.length > 0 && <div><div className="font-medium">يحتاج دعمًا</div><ul className="list-disc pe-5">{ai.needs_support.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {ai.guardian_tip && <Alert>{ai.guardian_tip}</Alert>}
        </CardContent></Card>
      ) : <Alert className="text-xs">الملخص النصي غير متاح الآن؛ الأرقام أعلاه كافية (السقوط الثابت).</Alert>}
    </div>
  );
}
