import "server-only";
import { createClient } from "@/shared/db/server";
import { loadTemplate, type MissionTemplate } from "@/modules/library";
import type { MissionRow, ReflectionRow } from "./types";

export async function getMission(id: string): Promise<{ mission: MissionRow; template: MissionTemplate; reflection: ReflectionRow | null } | null> {
  const db = await createClient();
  const { data } = await db.from("missions").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const mission = data as MissionRow;
  const [template, { data: refl }] = await Promise.all([
    loadTemplate(db, mission.template_id, mission.template_version),
    db.from("reflections").select("*").eq("mission_id", id).maybeSingle(),
  ]);
  if (!template) return null;
  return { mission, template, reflection: (refl as ReflectionRow | null) ?? null };
}

export async function listMissions(profileId: string, opts: { limit?: number; statuses?: string[] } = {}): Promise<MissionRow[]> {
  const db = await createClient();
  let q = db.from("missions").select("*").eq("profile_id", profileId).order("created_at", { ascending: false });
  if (opts.statuses) q = q.in("status", opts.statuses);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MissionRow[];
}

/** تاريخ اليوم بالمنطقة الزمنية للملف (القسم 13: حدود اليوم بالمنطقة الزمنية). */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
