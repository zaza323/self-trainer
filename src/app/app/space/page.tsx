import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getGameView, evaluatePlayLess } from "@/modules/game";
import { SpacePanel } from "@/modules/game/components/space-panel";
import { t } from "@/shared/i18n";
import type { AgeMode } from "@/shared/config";

/** P16 مساحتي + الإنجازات (GAME-1، GAME-5). "تلعب أقل" يُقيَّم هنا idempotent حتى تُجدول أسبوعيًا (المرحلة 6). */
export default async function SpacePage() {
  const s = (await getSession())!;
  const p = s.profile!;
  try { await evaluatePlayLess(createAdminClient(), p.id); } catch { /* بلا مفتاح خدمة محليًا */ }
  const db = await createClient();
  const view = await getGameView(db, { id: p.id, age_mode: p.age_mode as AgeMode, incentive_stage: p.incentive_stage, avatar_stage_max: p.avatar_stage_max ?? 1 });
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{t("nav.space")}</h2><SpacePanel view={view} /></div>;
}
