import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink, getGuardianLinks, getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { buildSettingsView, guardrailsList } from "@/modules/settings/build-view";
import { SettingsPanel } from "@/modules/settings/components/settings-panel";
import { Alert } from "@/shared/ui";
import { t } from "@/shared/i18n";
import explainers from "@content/explainers.ar.json";
import capabilities from "@content/capabilities.ar.json";

/** G07: الإعدادات والأقفال (CUST-3, CUST-4). */
export default async function GuardianSettingsPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link, links, s] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId), getGuardianLinks(playerId), getSession()]);
  if (!player || !link || !s) notFound();
  const db = await createClient();
  const isAccountOwner = player.age_mode === "child" ? link.is_creator : false;
  const { ageMode, views } = await buildSettingsView(db, {
    profileId: playerId,
    actor: { role: "guardian", userId: s.userId, permissions: link.permissions, isCreator: link.is_creator, isAccountOwner },
    links,
  });
  const capNames = Object.fromEntries(Object.entries(capabilities).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, (v as { name: string }).name]));
  return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-semibold">{t("settings.title")} — {player.display_name}</h2><p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p></div>
      {!isAccountOwner && !link.permissions.manage_settings && <Alert variant="warning">ليست لديك صلاحية (ضبط الإعدادات) لهذا المتدرب؛ العرض فقط.</Alert>}
      <SettingsPanel profileId={playerId} ageMode={ageMode!} role="guardian" items={views} guardrails={guardrailsList} guardrailsIntro={explainers.guardrails_intro} capabilityNames={capNames} lockedHint={explainers.settings_locked_hint} />
    </div>
  );
}
