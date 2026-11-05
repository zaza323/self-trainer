import { getSession, getGuardianLinks } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { buildSettingsView, guardrailsList } from "@/modules/settings/build-view";
import { SettingsPanel } from "@/modules/settings/components/settings-panel";
import { t } from "@/shared/i18n";
import explainers from "@content/explainers.ar.json";
import capabilities from "@content/capabilities.ar.json";
import { AccountData } from "@/modules/trial/components/account-data";

/** P17: الإعدادات (مع من ضبطها وهل مقفلة) — CUST-7. */
export default async function PlayerSettingsPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const links = await getGuardianLinks(s.profile!.id);
  const { ageMode, views } = await buildSettingsView(db, { profileId: s.profile!.id, actor: { role: "player", userId: s.userId }, links });
  const capNames = Object.fromEntries(Object.entries(capabilities).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, (v as { name: string }).name]));
  return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-semibold">{t("settings.title")}</h2><p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p></div>
      <SettingsPanel profileId={s.profile!.id} ageMode={ageMode!} role="player" items={views} guardrails={guardrailsList} guardrailsIntro={explainers.guardrails_intro} capabilityNames={capNames} lockedHint={explainers.settings_locked_hint} />
      <AccountData profileId={s.profile!.id} canDelete={s.profile!.age_mode !== "child"} />
    </div>
  );
}
