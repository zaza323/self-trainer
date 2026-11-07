import { notFound } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { RestTimer } from "@/modules/rest/components/rest-timer";
import type { RestSessionRow } from "@/modules/rest/service";
import content from "@content/rest_activities.ar.json";
import type { AgeMode } from "@/shared/config";

/** P42 مؤقت الراحة. */
export default async function RestSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
  const db = await createClient();
  const { data } = await db.from("rest_sessions").select("*").eq("id", id).maybeSingle();
  if (!data || data.profile_id !== s.profile!.id) notFound();
  const row = data as RestSessionRow;
  let title = (content.activities as Record<string, { name: string }>)[row.activity_key]?.name ?? row.activity_key;
  if (row.custom_activity_id) { const { data: c } = await db.from("custom_rest_activities").select("title").eq("id", row.custom_activity_id).maybeSingle(); if (c?.title) title = c.title as string; }
  const endsAt = new Date(new Date(row.started_at).getTime() + row.planned_min * 60000);
  const endsAtLabel = new Intl.DateTimeFormat("ar", { timeZone: s.profile!.timezone, hour: "2-digit", minute: "2-digit" }).format(endsAt);
  return <RestTimer sessionId={row.id} activityKey={row.activity_key} title={title} plannedMin={row.planned_min} startedAt={row.started_at} endsAtLabel={endsAtLabel} ageMode={s.profile!.age_mode as AgeMode} />;
}
