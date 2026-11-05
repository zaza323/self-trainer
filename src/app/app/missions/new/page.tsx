import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { aiEnabled } from "@/modules/companion";
import { RealMissionForm } from "@/modules/life/components/life-forms";
import { effective } from "@/modules/settings";
import { Alert } from "@/shared/ui";
import realMissions from "@content/real_missions.ar.json";

/** MIS-2: المستخدم يكتب مهمة واقعية بنفسه. في child قد تحتاج موافقة المربي. */
export default async function NewSelfMissionPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const { data: pc } = await db.from("personal_context").select("contexts").eq("profile_id", s.profile!.id).maybeSingle();
  const needs = s.profile!.age_mode === "child" ? (await effective<boolean>(db, s.profile!.id, "self_missions_require_approval")).value : false;
  return <div className="space-y-3">{needs && <Alert className="text-sm">{realMissions.needs_approval_notice}</Alert>}<RealMissionForm profileId={s.profile!.id} isSelf aiEnabled={aiEnabled()} extraContexts={(pc?.contexts as string[]) ?? []} /></div>;
}
