import { notFound } from "next/navigation";
import { getPlayerProfile, getMyLink } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { ContextEditor } from "@/modules/adaptation/components/context-editor";
import { emptyContext, type ContextField } from "@/modules/adaptation";
import { aiEnabled } from "@/modules/companion";
import { loadLife } from "@/modules/lifelog/service";
import { isStale, LIFE_FIELDS, type LifeField } from "@/modules/lifelog/rules";
import { LifeLogEditor } from "@/modules/lifelog/components/life-log-editor";
import { IntakeJourney } from "@/modules/lifelog/components/intake-journey";
import { Alert, Card, CardContent } from "@/shared/ui";
import { t } from "@/shared/i18n";
import content from "@content/life_log.ar.json";

/**
 * G12 سجل حياة المتدرب (0.5 أ.7/أ.9): في child يراه ويعدّله المربي صاحب manage_settings (يكتب مع الطفل).
 * في teen/adult: للمالك وحده إلا إذا فعّل share_life_log_with_guardians؛ وعند عدم المشاركة يرى المربي الأعداد فقط.
 */
export default async function GuardianContextPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId)]);
  if (!player || !link) notFound();
  const db = await createClient();
  const title = <h2 className="text-lg font-semibold">{content.guardian.title.replace("{name}", player.display_name ?? "")}</h2>;
  const { data: pc } = await db.from("personal_context").select("interests, routine, free_windows, contexts").eq("profile_id", playerId).maybeSingle();
  const canEdit = player.age_mode === "child" && (link.is_creator || link.permissions.manage_settings);
  if (!pc && !canEdit) {
    // RLS تحجب النصوص: الأعداد فقط
    const { data: counts } = await db.rpc("life_log_counts", { p_profile_id: playerId });
    const c = (counts ?? {}) as Record<string, number>;
    return (
      <div className="space-y-3">{title}<Alert variant="info" className="text-sm">{content.guardian.counts_only}</Alert>
        <Card><CardContent className="space-y-1 p-4 text-sm" data-testid="life-counts">{Object.entries(content.fields).map(([k, label]) => <p key={k}>{label}: {content.guardian.count.replace("{n}", String(c[k] ?? 0))}</p>)}</CardContent></Card>
      </div>
    );
  }
  const ctx = pc ? { interests: (pc.interests as string[]) ?? [], routine: (pc.routine as string[]) ?? [], free_windows: (pc.free_windows as string[]) ?? [], contexts: (pc.contexts as string[]) ?? [] } : emptyContext();
  const row = await loadLife(db, playerId);
  const now = new Date();
  const staleIds = LIFE_FIELDS.flatMap((f) => row.log[f]).filter((x) => isStale(x, now)).map((x) => x.id);
  const { data: sug } = canEdit ? await db.from("context_suggestions").select("id, field, value").eq("profile_id", playerId).eq("status", "pending") : { data: [] };
  const all = (sug ?? []) as Array<{ id: string; field: string; value: string }>;
  const isLife = (f: string) => (LIFE_FIELDS as readonly string[]).includes(f);
  return (
    <div className="space-y-3">
      {title}
      <p className="text-sm text-muted-foreground">{t("guardian.context")}</p>
      {canEdit && <p className="text-xs text-muted-foreground">{content.guardian.edit_note}</p>}
      {canEdit && row.intake_status !== "done" && <IntakeJourney profileId={playerId} log={row.log} step={row.intake_step} routine={ctx.routine} staleIds={staleIds} aiAvailable={aiEnabled()} guardianMode
        pending={all.filter((x) => isLife(x.field)).map((x) => ({ id: x.id, field: x.field as LifeField, text: x.value }))} />}
      <LifeLogEditor profileId={playerId} log={row.log} staleIds={staleIds} readOnly={!canEdit} />
      <ContextEditor profileId={playerId} context={ctx} suggestions={all.filter((x) => !isLife(x.field)) as Array<{ id: string; field: ContextField; value: string }>} readOnly={!canEdit} />
    </div>
  );
}
