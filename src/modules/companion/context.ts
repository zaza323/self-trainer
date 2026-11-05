import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPPORT_LEVELS, type AgeMode, type SupportLevel } from "@/shared/config";
import type { ChatContext } from "./chat/service";

/** AI-7: ذاكرة المرافق = مؤشرات التعلم + ملخص آخر محادثة + سياق الحياة (المرحلة 5) — لا النص الكامل. من يرى المحادثة (AI-4). */
export async function buildChatContext(admin: SupabaseClient, profile: { id: string; age_mode: AgeMode }): Promise<ChatContext> {
  const [{ data: links }, { data: states }, { data: insights }, { data: lastSession }, { data: pc }] = await Promise.all([
    admin.from("guardian_links").select("guardian_id, relation, permissions").eq("player_id", profile.id).eq("status", "active"),
    admin.from("capability_states").select("support_level").eq("profile_id", profile.id),
    admin.from("companion_insights").select("capability_id, type, value").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(8),
    admin.from("companion_sessions").select("summary").eq("profile_id", profile.id).not("summary", "is", null).order("started_at", { ascending: false }).limit(1),
    admin.from("personal_context").select("interests, routine, free_windows, contexts").eq("profile_id", profile.id).maybeSingle(),
  ]);
  const viewers = ((links ?? []) as Array<{ guardian_id: string; relation: string; permissions: Record<string, boolean> }>).filter((l) => l.permissions.view_chat);
  const ids = viewers.map((v) => v.guardian_id);
  const { data: names } = ids.length ? await admin.from("profiles").select("user_id, display_name").in("user_id", ids) : { data: [] };
  const nameOf = new Map(((names ?? []) as Array<{ user_id: string; display_name: string }>).map((n) => [n.user_id, n.display_name]));
  const levels = ((states ?? []) as Array<{ support_level: SupportLevel }>).map((s) => SUPPORT_LEVELS.indexOf(s.support_level));
  const avg = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 1;
  return {
    profileId: profile.id,
    mode: profile.age_mode,
    support: SUPPORT_LEVELS[Math.min(3, Math.max(0, avg))]!,
    viewers: viewers.map((v) => ({ name: nameOf.get(v.guardian_id) ?? v.relation, relation: v.relation })),
    memory: {
      insights: ((insights ?? []) as Array<{ capability_id: string; type: string; value: number }>).map((i) => `${i.capability_id}:${i.type}=${i.value}`),
      lastSummary: ((lastSession ?? [])[0]?.summary as string | undefined) ?? null,
      personalContext: (pc as Record<string, unknown> | null) ?? null,
    },
  };
}
