import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { SuggestionsPanel, type SuggestionRow } from "@/modules/adaptation/components/suggestions-panel";
import { customization } from "@/shared/config";
import content from "@content/adaptation.ar.json";

/** G11 اقتراحات التكيّف للمربي (GUARD-10): يقرر المنشئ أو من له approve_suggestions. */
export default async function GuardianSuggestionsPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link) notFound();
  const db = await createClient();
  const { data } = await db.from("adaptation_suggestions").select("*").eq("profile_id", playerId).order("created_at", { ascending: false }).limit(30);
  const canDecide = link.is_creator || Boolean((link.permissions as Record<string, boolean>)[customization.adaptation.approver_permission]);
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.suggestions.title} — {player.display_name}</h2><SuggestionsPanel items={(data ?? []) as SuggestionRow[]} canDecide={canDecide} /></div>;
}
