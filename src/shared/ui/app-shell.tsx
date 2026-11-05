import Link from "next/link";
import { Button } from "@/shared/ui";
import { t } from "@/shared/i18n";

export function AppShell({ title, nav, children, user, chatHref }: { title: string; nav: Array<{ href: string; label: string }>; children: React.ReactNode; user: { name: string; badge?: string }; chatHref?: string }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <div className="text-sm text-muted-foreground">{user.name}{user.badge ? ` · ${user.badge}` : ""}</div>
            <h1 className="text-xl font-bold">{title}</h1>
          </div>
          <form action="/auth/signout" method="post"><Button variant="ghost" size="sm" type="submit">{t("common.signout")}</Button></form>
        </div>
        <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 pb-2" aria-label="التنقل">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full border px-3 py-1.5 text-sm hover:bg-muted">{n.label}</Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl p-4 pb-16">{children}</main>
      {chatHref && <Link href={chatHref} aria-label={t("nav.chat")} className="fixed bottom-4 end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg">💬</Link>}
    </div>
  );
}
