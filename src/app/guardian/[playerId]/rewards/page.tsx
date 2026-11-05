import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink, getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadRewardsView } from "@/modules/rewards/queries";
import { GuardianRewardsPanel } from "@/modules/rewards/components/rewards-panel";
import { Alert } from "@/shared/ui";
import type { AgeMode } from "@/shared/config";

/** G05 + G06: المكافآت الواقعية والإنجازات الخاصة (REWARD-1..7، GAME-10). */
export default async function GuardianRewardsPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link, s] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId), getSession()]);
  if (!player || !link || !s) notFound();
  if (!link.is_creator && !link.permissions.add_rewards) return <Alert variant="warning">ليست لديك صلاحية (إضافة مكافآت) لهذا المتدرب.</Alert>;
  const db = await createClient();
  const v = await loadRewardsView(db, playerId, player.age_mode as AgeMode);
  return <GuardianRewardsPanel profileId={playerId} rewards={v.rewards} achievements={v.achievements} goals={v.goals} stage={player.incentive_stage} creatorName={s.profile?.display_name ?? "المربي"} />;
}
