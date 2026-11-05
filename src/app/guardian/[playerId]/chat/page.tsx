import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink, getGuardianLinks, getSession } from "@/modules/accounts";
import { getGuardianNames } from "@/modules/guardian/queries";
import { createClient } from "@/shared/db/server";
import { disclosureLine } from "@/modules/companion";
import { ChatPanel, type ChatMessage } from "@/modules/companion/components/chat-panel";
import { Alert, Badge } from "@/shared/ui";
import { t } from "@/shared/i18n";

/** G03: المحادثة الحية والتدخل (GUARD-6، AI-10، AI-11، GUARD-8). */
export default async function GuardianChatPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link, links, s] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId), getGuardianLinks(playerId), getSession()]);
  if (!player || !link || !s) notFound();
  if (!link.is_creator && !link.permissions.view_chat) return <Alert variant="warning">ليست لديك صلاحية (رؤية المحادثة) لهذا المتدرب.</Alert>;
  const db = await createClient();
  const names = await getGuardianNames(links);
  const { data: sess } = await db.from("companion_sessions").select("id, handoff, handoff_guardian_id, mode").eq("profile_id", playerId).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
  const session = (sess ?? [])[0] as { id: string; handoff: "ai" | "guardian"; handoff_guardian_id: string | null; mode: string } | undefined;
  const { data: msgs } = session ? await db.from("companion_messages").select("*").eq("session_id", session.id).order("created_at") : { data: [] };
  const { data: pending } = session ? await db.from("human_requests").select("id, reason, requested_by").eq("session_id", session.id).is("resolved_at", null) : { data: [] };
  const viewers = links.filter((l) => l.status === "active" && l.permissions.view_chat).map((l) => ({ name: names[l.guardian_id] ?? l.relation, relation: t(`relations.${l.relation}`) }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("chat.live_title")} — {player.display_name}</h2>{session && <Badge variant="muted">{session.mode}</Badge>}</div>
      {(pending ?? []).length > 0 && <Alert variant="warning">{t("chat.human_requested")}{(pending as Array<{ reason: string | null }>)[0]?.reason ? `: ${(pending as Array<{ reason: string | null }>)[0]!.reason}` : ""}</Alert>}
      {!session && <Alert>{t("chat.no_session")}</Alert>}
      <ChatPanel sessionId={session?.id ?? null} messages={(msgs ?? []) as ChatMessage[]} disclosure={disclosureLine(viewers)} viewer="guardian" handoff={session?.handoff ?? "ai"} handoffGuardianName={session?.handoff_guardian_id ? names[session.handoff_guardian_id] ?? null : null} canIntervene={link.is_creator || link.permissions.intervene_chat} realtime />
    </div>
  );
}
