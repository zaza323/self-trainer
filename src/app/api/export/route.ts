import { NextResponse } from "next/server";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { track } from "@/modules/trial";
import { CONFIG_VERSION } from "@/shared/config";

export const dynamic = "force-dynamic";

/** 8.4: تصدير بيانات بصيغة JSON مقروءة — للمالك، أو للمربي المنشئ عن طفله (?profile=). كل القراءة عبر RLS. */
const TABLES: Array<[string, string]> = [
  ["settings", "profile_id"], ["consents", "profile_id"], ["goals", "profile_id"], ["missions", "profile_id"], ["evidence_events", "profile_id"], ["capability_states", "profile_id"],
  ["capability_snapshots", "profile_id"], ["xp_events", "profile_id"], ["transfer_reports", "profile_id"], ["guardian_observations", "profile_id"], ["rewards", "profile_id"],
  ["profile_achievements", "profile_id"], ["collectibles", "profile_id"], ["personal_context", "profile_id"], ["strategy_outcomes", "profile_id"], ["adaptation_suggestions", "profile_id"],
  ["notifications", "profile_id"], ["companion_sessions", "profile_id"], ["safety_flags", "profile_id"], ["surprise_events", "profile_id"], ["challenge_participants", "profile_id"], ["mission_schedules", "profile_id"],
];

export async function GET(req: Request) {
  const s = await getSession();
  if (!s?.profile) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const profileId = url.searchParams.get("profile") ?? s.profile.id;
  const db = await createClient();
  const { data: profile } = await db.from("profiles").select("*").eq("id", profileId).maybeSingle();
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), config_version: CONFIG_VERSION, profile };
  for (const [table, col] of TABLES) {
    const { data } = await db.from(table).select("*").eq(col, profileId);
    out[table] = data ?? [];
  }
  const sessions = (out.companion_sessions as Array<{ id: string }>).map((x) => x.id);
  const { data: msgs } = sessions.length ? await db.from("companion_messages").select("*").in("session_id", sessions) : { data: [] };
  out.companion_messages = msgs ?? [];
  const missions = (out.missions as Array<{ id: string }>).map((x) => x.id);
  const { data: refl } = missions.length ? await db.from("reflections").select("*").in("mission_id", missions) : { data: [] };
  out.reflections = refl ?? [];
  try { await track(createAdminClient(), { event: "export_requested", profileId }); } catch { /* بلا مفتاح خدمة */ }
  return new NextResponse(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="self-trainer-export-${profileId.slice(0, 8)}.json"` } });
}
