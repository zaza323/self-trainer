import { getSession, getGuardianLinks } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { buildSettingsView, guardrailsList } from "@/modules/settings/build-view";
import { SettingsPanel } from "@/modules/settings/components/settings-panel";
import { t } from "@/shared/i18n";
import explainers from "@content/explainers.ar.json";
import capabilities from "@content/capabilities.ar.json";
import { AccountData } from "@/modules/trial/components/account-data";
import { currentState } from "@/modules/engagement/service";
import { EngagementSettings } from "@/modules/engagement/components/engagement-settings";

/** P17: الإعدادات (مع من ضبطها وهل مقفلة) — CUST-7. */
export default async function PlayerSettingsPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const links = await getGuardianLinks(s.profile!.id);
  const { ageMode, views } = await buildSettingsView(db, { profileId: s.profile!.id, actor: { role: "player", userId: s.userId }, links });
  const [state, { data: windows }, { data: dnd }] = await Promise.all([currentState(db, s.profile!.id), db.from("busy_windows").select("id, weekday, start_hour, end_hour, source").eq("profile_id", s.profile!.id).eq("active", true), db.from("dnd_periods").select("id").eq("profile_id", s.profile!.id).or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`).limit(1)]);
  const capNames = Object.fromEntries(Object.entries(capabilities).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, (v as { name: string }).name]));
  return (
    <div className="space-y-4">
      <div><h2 className="text-lg font-semibold">{t("settings.title")}</h2><p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p></div>
      <SettingsPanel profileId={s.profile!.id} ageMode={ageMode!} role="player" items={views} guardrails={guardrailsList} guardrailsIntro={explainers.guardrails_intro} capabilityNames={capNames} lockedHint={explainers.settings_locked_hint} />
      <EngagementSettings state={state} windows={(windows ?? []) as Array<{ id: string; weekday: number; start_hour: number; end_hour: number; source: string }>} dndActive={Boolean(dnd?.length)} />
      <AccountData profileId={s.profile!.id} canDelete={s.profile!.age_mode !== "child"} />
    </div>
  );
}
