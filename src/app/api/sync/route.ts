import { NextResponse } from "next/server";
import { getSession } from "@/modules/accounts";
import { getMission } from "@/modules/missions";
import { applyClientOps, syncBatchSchema } from "@/modules/sync";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import type { AgeMode } from "@/shared/config";

export const dynamic = "force-dynamic";

/** طابور المزامنة (المرحلة 6): يستقبل دفعة عمليات بمفاتيح من الجهاز ويطبقها مرة واحدة فقط. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s?.profile || s.profile.kind !== "player") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = syncBatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const db = await createClient();
  const results = await applyClientOps({ db, admin: createAdminClient, profileId: s.profile.id, mode: s.profile.age_mode as AgeMode, loadMission: getMission }, parsed.data.ops);
  return NextResponse.json({ results });
}
