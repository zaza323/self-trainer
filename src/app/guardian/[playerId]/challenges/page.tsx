import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadActiveTemplates, textByMode } from "@/modules/library";
import type { ChallengeRow, ParticipantRow } from "@/modules/challenges";
import { GuardianChallengeApprovals } from "@/modules/challenges/components/challenges-ui";
import { Alert } from "@/shared/ui";
import type { AgeMode } from "@/shared/config";

/** G13 موافقة المربي على تحديات الطفل (المنشئ أو manage_settings). */
export default async function GuardianChallengesPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link) notFound();
  if (!link.is_creator && !link.permissions.manage_settings) return <Alert variant="warning">ليست لديك صلاحية (إدارة الإعدادات) لهذا المتدرب.</Alert>;
  const db = await createClient();
  const { data: parts } = await db.from("challenge_participants").select("*").eq("profile_id", playerId).eq("requires_approval", true).is("approved_by_guardian_id", null).is("left_at", null);
  const rows = (parts ?? []) as ParticipantRow[];
  const { data: chs } = rows.length ? await db.from("challenges").select("*").in("id", rows.map((r) => r.challenge_id)) : { data: [] };
  const templates = await loadActiveTemplates(db);
  const byT = new Map(templates.map((t) => [t.id, t]));
  const pending = rows.map((r) => { const c = ((chs ?? []) as ChallengeRow[]).find((x) => x.id === r.challenge_id); return { challenge_id: r.challenge_id, profile_id: r.profile_id, display_name: r.display_name, title: c ? textByMode(byT.get(c.template_id)?.title, player.age_mode as AgeMode) || c.template_id : r.challenge_id }; });
  return <GuardianChallengeApprovals pending={pending} />;
}
