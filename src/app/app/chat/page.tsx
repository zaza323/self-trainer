import { getSession, getGuardianLinks } from "@/modules/accounts";
import { getGuardianNames } from "@/modules/guardian/queries";
import { createClient } from "@/shared/db/server";
import { disclosureLine, aiEnabled } from "@/modules/companion";
import { ChatPanel, type ChatMessage } from "@/modules/companion/components/chat-panel";
import { Alert } from "@/shared/ui";
import { t } from "@/shared/i18n";
import messagesContent from "@content/companion_messages.ar.json";
import type { AgeMode } from "@/shared/config";

/** P14 المحادثة الحرة (AI-1، AI-4، AI-13). */
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: modeParam } = await searchParams;
  const mode = (["comeback", "daily_moment", "mirror", "weekly_review"].includes(modeParam ?? "") ? modeParam : "free") as "free" | "comeback" | "daily_moment" | "mirror" | "weekly_review";
  const s = (await getSession())!;
  const profile = s.profile!;
  const db = await createClient();
  const links = (await getGuardianLinks(profile.id)).filter((l) => l.status === "active");
  const names = await getGuardianNames(links);
  const viewers = links.filter((l) => l.permissions.view_chat).map((l) => ({ name: names[l.guardian_id] ?? t(`relations.${l.relation}`), relation: t(`relations.${l.relation}`) }));
  const interveners = links.filter((l) => l.permissions.intervene_chat).map((l) => names[l.guardian_id] ?? t(`relations.${l.relation}`));
  const { data: sess } = await db.from("companion_sessions").select("id, handoff, handoff_guardian_id").eq("profile_id", profile.id).eq("mode", mode).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
  const session = (sess ?? [])[0] as { id: string; handoff: "ai" | "guardian"; handoff_guardian_id: string | null } | undefined;
  const { data: msgs } = session ? await db.from("companion_messages").select("*").eq("session_id", session.id).order("created_at") : { data: [] };
  const ageMode = profile.age_mode as AgeMode;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t("nav.chat")}</h2>
      {!aiEnabled() && <Alert variant="warning" className="text-xs">المرافق غير مفعّل على هذا الخادم (لا مفتاح). الردود ثابتة.</Alert>}
      <ChatPanel sessionId={session?.id ?? null} messages={(msgs ?? []) as ChatMessage[]} disclosure={disclosureLine(viewers)} viewer="player" handoff={session?.handoff ?? "ai"} handoffGuardianName={session?.handoff_guardian_id ? names[session.handoff_guardian_id] ?? null : null} guardianNames={interveners} mode={mode} intro={mode === "comeback" ? `${messagesContent.comeback_intro[ageMode]} ${messagesContent.comeback_question[ageMode]}` : undefined} realtime />
    </div>
  );
}
