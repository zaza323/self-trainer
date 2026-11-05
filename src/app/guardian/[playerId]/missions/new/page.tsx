import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { aiEnabled } from "@/modules/companion";
import { RealMissionForm } from "@/modules/life/components/life-forms";
import { Alert } from "@/shared/ui";

/** G04: إضافة مهمة واقعية / متكررة (LIFE-3، MIS-10). */
export default async function GuardianNewMissionPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link) notFound();
  if (!link.is_creator && !link.permissions.add_missions) return <Alert variant="warning">ليست لديك صلاحية (إضافة مهام) لهذا المتدرب.</Alert>;
  const db = await createClient();
  const { data: pc } = await db.from("personal_context").select("contexts").eq("profile_id", playerId).maybeSingle();
  return <RealMissionForm profileId={playerId} isSelf={false} aiEnabled={aiEnabled()} extraContexts={(pc?.contexts as string[]) ?? []} />;
}
