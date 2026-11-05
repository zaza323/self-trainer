import "server-only";
import { cache } from "react";
import { createClient } from "@/shared/db/server";
import type { ProfileRow, GuardianLinkRow } from "@/shared/db/types";

export type Session = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  profile: ProfileRow | null;
};

/** الجلسة + الملف الشخصي للمستخدم الحالي (مخبّأة لكل طلب). */
export const getSession = cache(async (): Promise<Session | null> => {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await db.from("profiles").select("*").eq("user_id", data.user.id).maybeSingle();
  const appRole = (data.user.app_metadata as { role?: string } | undefined)?.role;
  return { userId: data.user.id, email: data.user.email ?? null, isAdmin: appRole === "admin", profile: (profile as ProfileRow | null) ?? null };
});

/** المتدربون المرتبطون بالمربي الحالي (ACC-4). */
export async function getLinkedPlayers(): Promise<Array<{ link: GuardianLinkRow; player: ProfileRow }>> {
  const db = await createClient();
  const { data: links } = await db.from("guardian_links").select("*").eq("status", "active");
  const s = await getSession();
  const mine = ((links ?? []) as GuardianLinkRow[]).filter((l) => l.guardian_id === s?.userId);
  if (mine.length === 0) return [];
  const { data: players } = await db.from("profiles").select("*").in("id", mine.map((l) => l.player_id));
  const byId = new Map(((players ?? []) as ProfileRow[]).map((p) => [p.id, p]));
  return mine.flatMap((link) => (byId.get(link.player_id) ? [{ link, player: byId.get(link.player_id)! }] : []));
}

export async function getPlayerProfile(playerId: string): Promise<ProfileRow | null> {
  const db = await createClient();
  const { data } = await db.from("profiles").select("*").eq("id", playerId).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

/** روابط المربين لمتدرب (كل من له حق الرؤية عبر RLS). */
export async function getGuardianLinks(playerId: string): Promise<GuardianLinkRow[]> {
  const db = await createClient();
  const { data } = await db.from("guardian_links").select("*").eq("player_id", playerId).order("created_at");
  return (data ?? []) as GuardianLinkRow[];
}

/** رابط المربي الحالي بمتدرب معين (لتحديد صلاحياته في الواجهة). */
export async function getMyLink(playerId: string): Promise<GuardianLinkRow | null> {
  const s = await getSession();
  if (!s) return null;
  const links = await getGuardianLinks(playerId);
  return links.find((l) => l.guardian_id === s.userId && l.status === "active") ?? null;
}
