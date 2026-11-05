import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { Inbox, type InboxItem } from "@/modules/notifications/components/inbox";
import { PushToggle } from "@/modules/notifications/components/push-toggle";
import content from "@content/notifications.ar.json";

/** صندوق إشعارات المتدرب + تفعيل إشعارات الجهاز (NOTIF-1..4). */
export default async function PlayerNotificationsPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const { data } = await db.from("notifications").select("id, type, title, body, url, scheduled_for, sent_at, read_at, payload").eq("profile_id", s.profile!.id).order("scheduled_for", { ascending: false }).limit(50);
  const items = ((data ?? []) as Array<InboxItem & { payload: Record<string, unknown> }>).filter((n) => !n.payload.guardian_id);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{content.inbox.title}</h2>
      <PushToggle audience="player" />
      <Inbox items={items} />
    </div>
  );
}
