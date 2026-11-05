import { redirect } from "next/navigation";
import { getSession, getLinkedPlayers } from "@/modules/accounts";
import { AppShell } from "@/shared/ui/app-shell";
import { t } from "@/shared/i18n";

export default async function GuardianLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.profile) redirect("/onboarding");
  const players = await getLinkedPlayers();
  const nav = [
    { href: "/guardian", label: t("guardian.dashboard") },
    ...players.map(({ player }) => ({ href: `/guardian/${player.id}`, label: player.display_name })),
    { href: "/guardian/notifications", label: t("guardian.notifications") },
    { href: "/guardian/children/new", label: t("guardian.new_child") },
    ...(s.profile.kind === "player" ? [{ href: "/app", label: t("nav.home") }] : []),
  ];
  return <AppShell title={t("guardian.dashboard")} nav={nav} user={{ name: s.profile.display_name, badge: t("modes.guardian") }}>{children}</AppShell>;
}
