import { notFound } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { loadTemplate, textByMode } from "@/modules/library";
import type { ChallengeRow, ParticipantRow } from "@/modules/challenges";
import { ChallengeBoard, type ScoreRow } from "@/modules/challenges/components/challenges-ui";
import type { AgeMode } from "@/shared/config";

/** P22 لوحة التحدي ونتيجته مع الأوسمة (للمشاركين فقط عبر RLS). */
export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
  const db = await createClient();
  const { data: c } = await db.from("challenges").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const ch = c as ChallengeRow;
  const [{ data: parts }, { data: scores }, template] = await Promise.all([
    db.from("challenge_participants").select("*").eq("challenge_id", id),
    db.from("challenge_scores").select("*").eq("challenge_id", id),
    loadTemplate(db, ch.template_id, ch.template_version),
  ]);
  const participants = ((parts ?? []) as ParticipantRow[]).filter((p) => !p.left_at && (!p.requires_approval || p.approved_by_guardian_id));
  return <ChallengeBoard challenge={ch} title={textByMode(template?.title, s.profile!.age_mode as AgeMode) || ch.template_id} participants={participants} scores={(scores ?? []) as ScoreRow[]} myProfileId={s.profile!.id} />;
}
