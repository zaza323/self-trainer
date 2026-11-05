import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadRewardsView } from "@/modules/rewards/queries";
import { PledgesPanel, GuardianRewardsPanel } from "@/modules/rewards/components/rewards-panel";
import { customization, type AgeMode } from "@/shared/config";
import rewardsContent from "@content/rewards.ar.json";

/** P15 عهودي (REWARD-5): تظهر مهما كانت كثافة اللعبة. البالغ ينشئ لنفسه (adult_self_rewards). */
export default async function PledgesPage() {
  const s = (await getSession())!;
  const p = s.profile!;
  const db = await createClient();
  const v = await loadRewardsView(db, p.id, p.age_mode as AgeMode);
  const selfCreate = p.age_mode === "adult" && customization.real_rewards.adult_self_rewards
    ? <GuardianRewardsPanel profileId={p.id} rewards={[]} achievements={v.achievements} goals={v.goals} stage={p.incentive_stage} creatorName={p.display_name} />
    : undefined;
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{rewardsContent.my_pledges}</h2><PledgesPanel rewards={v.rewards} achievements={v.achievements} goals={v.goals} creatorNames={{ ...v.creatorNames, [s.userId]: p.display_name }} selfCreate={selfCreate} /></div>;
}
