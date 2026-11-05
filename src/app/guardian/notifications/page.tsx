import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { Inbox, type InboxItem } from "@/modules/notifications/components/inbox";
import { PushToggle } from "@/modules/notifications/components/push-toggle";
import { t } from "@/shared/i18n";

/** G09 التنبيهات (GUARD-2، NOTIF-5): ما وُجّه إلى هذا المربي عبر payload.guardian_id. */
export default async function GuardianNotificationsPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const { data } = await db.from("notifications").select("id, type, title, body, url, scheduled_for, sent_at, read_at, payload").contains("payload", { guardian_id: s.userId }).order("scheduled_for", { ascending: false }).limit(50);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("guardian.notifications")}</h2>
      <PushToggle audience="guardian" />
      <Inbox items={(data ?? []) as InboxItem[]} />
    </div>
  );
}
