import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { AppShell } from "@/shared/ui/app-shell";
import { t } from "@/shared/i18n";
import { SyncManager } from "@/shared/offline/sync-manager";
import { challengesVisible } from "@/modules/challenges";
import { createClient } from "@/shared/db/server";
import marginsContent from "@content/margins.ar.json";

export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.profile) redirect("/onboarding");
  if (s.profile.kind !== "player") redirect("/guardian");
  const mode = s.profile.age_mode!;
  const showChallenges = await challengesVisible(await createClient(), { id: s.profile.id, game_intensity: s.profile.game_intensity });
  const nav = [
    { href: "/app", label: t("nav.start") },
    { href: "/app/home", label: t("nav.home") },
    { href: "/app/planner", label: t("nav.planner") },
    { href: "/app/rest", label: t("nav.rest") },
    { href: "/app/muhasaba", label: t("nav.muhasaba") },
    { href: "/app/goals", label: t("nav.goals") },
    { href: "/app/missions", label: t("nav.missions") },
    { href: "/app/map", label: t("nav.map") },
    { href: "/app/space", label: t("nav.space") },
    { href: "/app/chat", label: t("nav.chat") },
    { href: "/app/pledges", label: t("nav.pledges") },
    ...(showChallenges ? [{ href: "/app/challenges", label: t("nav.challenges") }] : []),
    { href: "/app/context", label: t("nav.context") },
    { href: "/app/suggestions", label: t("nav.suggestions") },
    { href: "/app/margins", label: marginsContent.ui.title },
    { href: "/app/notifications", label: t("nav.notifications") },
    { href: "/app/settings", label: t("nav.settings") },
    ...(mode !== "child" ? [{ href: "/app/guardians", label: t("nav.guardians") }] : []),
  ];
  return <AppShell title={t("home.title")} nav={nav} user={{ name: s.profile.display_name, badge: t(`modes.${mode}`) }} chatHref="/app/chat"><SyncManager timezone={s.profile.timezone} />{children}</AppShell>;
}
