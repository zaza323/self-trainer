import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink, getGuardianLinks, getSession } from "@/modules/accounts";
import { getInvites, getGuardianNames } from "@/modules/guardian/queries";
import { GuardiansPanel } from "@/modules/guardian/components/guardians-panel";
import { t } from "@/shared/i18n";

/** G08: إدارة المربين والصلاحيات (GUARD-7). */
export default async function GuardianManagePage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link, links, s] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId), getGuardianLinks(playerId), getSession()]);
  if (!player || !link || !s) notFound();
  const canManage = link.is_creator || link.permissions.manage_guardians;
  const [invites, names] = await Promise.all([canManage ? getInvites(playerId) : Promise.resolve([]), getGuardianNames(links)]);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("guardians.title")} — {player.display_name}</h2>
      <GuardiansPanel playerId={playerId} ageMode={player.age_mode!} currentUserId={s.userId} canManage={canManage} links={links} invites={invites} guardianNames={names} />
    </div>
  );
}
