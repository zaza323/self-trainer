import "server-only";
import { createClient } from "@/shared/db/server";
import type { GuardianInviteRow, GuardianLinkRow } from "@/shared/db/types";

export async function getInvites(playerId: string): Promise<GuardianInviteRow[]> {
  const db = await createClient();
  const { data } = await db.from("guardian_invites").select("*").eq("player_id", playerId).order("created_at", { ascending: false });
  return (data ?? []) as GuardianInviteRow[];
}

/** أسماء المربين من ملفاتهم (قد لا تكون كلها مرئية عبر RLS؛ يسقط إلى الصفة). */
export async function getGuardianNames(links: GuardianLinkRow[]): Promise<Record<string, string>> {
  const db = await createClient();
  const ids = [...new Set(links.map((l) => l.guardian_id))];
  if (ids.length === 0) return {};
  const { data } = await db.from("profiles").select("user_id, display_name").in("user_id", ids);
  return Object.fromEntries(((data ?? []) as Array<{ user_id: string; display_name: string }>).map((p) => [p.user_id, p.display_name]));
}
