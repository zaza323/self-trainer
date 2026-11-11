import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { MarginBoard } from "@/modules/margins/components/margin-board";
import type { AgeMode } from "@/shared/config";
import content from "@content/margins.ar.json";

/** هامش الوقت للمتدرب: teen/adult يعدّل هامش مهامه وقواعده؛ child يرى فقط (ب.2). */
export default async function MyMarginsPage() {
  const s = (await getSession())!;
  const mode = s.profile!.age_mode as AgeMode;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{content.ui.title}</h2>
      <MarginBoard db={await createClient()} profileId={s.profile!.id} mode={mode} viewerId={s.userId} canSet={mode !== "child"} canLock={false} />
    </div>
  );
}
