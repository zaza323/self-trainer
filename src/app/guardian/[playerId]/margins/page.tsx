import { notFound } from "next/navigation";
import Link from "next/link";
import { getPlayerProfile, getMyLink, getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { MarginBoard } from "@/modules/margins/components/margin-board";
import { SuggestionsPanel, type SuggestionRow } from "@/modules/adaptation/components/suggestions-panel";
import { customization, margins, type AgeMode } from "@/shared/config";
import { Alert } from "@/shared/ui";
import content from "@content/margins.ar.json";

/** G17 «هامش الوقت» + G18 «سجل الهوامش وقواعدها» للمربي. الضبط بصلاحية set_task_margin ضمن نطاقه (يُفحص في القاعدة). */
export default async function GuardianMarginsPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link, s] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId), getSession()]);
  if (!player || !link || !s) notFound();
  const mode = player.age_mode as AgeMode;
  const perms = link.permissions as Record<string, boolean>;
  const canSet = (link.is_creator && mode === "child") || Boolean(perms[margins.permission.key]);
  const db = await createClient();
  const { data } = await db.from("adaptation_suggestions").select("*").eq("profile_id", playerId).eq("type", margins.review.suggestion_type).order("created_at", { ascending: false }).limit(margins.ui.log_limit);
  const canDecide = link.is_creator || Boolean(perms[customization.adaptation.approver_permission]);
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{content.ui.title} — {player.display_name}</h2>
      {!canSet && <Alert className="text-sm">{content.errors.no_permission}</Alert>}
      {(link.is_creator || perms.manage_settings || canSet) && <Link href={`/guardian/${playerId}/settings`} className="text-sm underline">{content.ui.mode_title}</Link>}
      <MarginBoard db={db} profileId={playerId} mode={mode} viewerId={s.userId} canSet={canSet} canLock={link.is_creator && mode === "child"}>
        {(data ?? []).length > 0 && <div className="space-y-2"><h3 className="text-base font-medium">{content.ui.review_title}</h3><SuggestionsPanel items={(data ?? []) as SuggestionRow[]} canDecide={canDecide} /></div>}
      </MarginBoard>
    </div>
  );
}
