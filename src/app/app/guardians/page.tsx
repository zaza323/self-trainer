import { redirect } from "next/navigation";
import { getSession, getGuardianLinks } from "@/modules/accounts";
import { getInvites, getGuardianNames } from "@/modules/guardian/queries";
import { GuardiansPanel } from "@/modules/guardian/components/guardians-panel";
import { t } from "@/shared/i18n";

/** ACC-5/ACC-7/ACC-10: المتدرب (teen/adult) يدعو مربين ويملك صلاحياتهم. */
export default async function PlayerGuardiansPage() {
  const s = (await getSession())!;
  if (s.profile!.age_mode === "child") redirect("/app");
  const [links, invites] = await Promise.all([getGuardianLinks(s.profile!.id), getInvites(s.profile!.id)]);
  const names = await getGuardianNames(links);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("guardians.title")}</h2>
      <GuardiansPanel playerId={s.profile!.id} ageMode={s.profile!.age_mode!} currentUserId={s.userId} canManage links={links} invites={invites} guardianNames={names} />
    </div>
  );
}
