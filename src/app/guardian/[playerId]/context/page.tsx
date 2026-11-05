import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { ContextEditor } from "@/modules/adaptation/components/context-editor";
import { emptyContext, type ContextField } from "@/modules/adaptation";
import { t } from "@/shared/i18n";

/** G12: سياق حياة الطفل (يحرره المربي في child بصلاحية manage_settings؛ للقراءة في teen/adult بـ view_progress). */
export default async function GuardianContextPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link) notFound();
  const db = await createClient();
  const { data: pc } = await db.from("personal_context").select("interests, routine, free_windows, contexts").eq("profile_id", playerId).maybeSingle();
  const ctx = pc ? { interests: (pc.interests as string[]) ?? [], routine: (pc.routine as string[]) ?? [], free_windows: (pc.free_windows as string[]) ?? [], contexts: (pc.contexts as string[]) ?? [] } : emptyContext();
  const canEdit = player.age_mode === "child" && (link.is_creator || link.permissions.manage_settings);
  const { data: sug } = canEdit ? await db.from("context_suggestions").select("id, field, value").eq("profile_id", playerId).eq("status", "pending") : { data: [] };
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{t("guardian.context")} — {player.display_name}</h2><ContextEditor profileId={playerId} context={ctx} suggestions={(sug ?? []) as Array<{ id: string; field: ContextField; value: string }>} readOnly={!canEdit} /></div>;
}
