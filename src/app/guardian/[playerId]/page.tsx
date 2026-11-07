import { notFound } from "next/navigation";
import Link from "next/link";
import plannerContent from "@content/planner.ar.json";
import { getPlayerProfile, getMyLink, getSession } from "@/modules/accounts";
import { listMissions } from "@/modules/missions";
import { loadActiveTemplates, textByMode } from "@/modules/library";
import { createClient } from "@/shared/db/server";
import type { AgeMode } from "@/shared/config";
import { buildMapView } from "@/modules/capabilities/queries";
import { CapabilityMap } from "@/modules/capabilities/components/capability-map";
import { ObservationForm, MoreSupportForm, ApprovalsList, ConfirmTransferButton } from "@/modules/life/components/life-forms";
import realMissions from "@content/real_missions.ar.json";
import { AccountData } from "@/modules/trial/components/account-data";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import { AgeTransitionForm } from "@/shared/ui/forms/age-transition-form";
import { t } from "@/shared/i18n";

export default async function PlayerOverviewPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const [player, link, s] = await Promise.all([getPlayerProfile(playerId), getMyLink(playerId), getSession()]);
  if (!player || !link) notFound();
  const canManage = link.is_creator || link.permissions.manage_guardians;
  const canView = link.is_creator || link.permissions.view_progress;
  const db = await createClient();
  const [recent, templates] = canView ? await Promise.all([listMissions(player.id, { limit: 10 }), loadActiveTemplates(db)]) : [[], []];
  const byId = new Map(templates.map((x) => [x.id, x]));
  const mapView = canView ? await buildMapView(db, player.id, player.age_mode as AgeMode) : null;
  const canAddMissions = link.is_creator || link.permissions.add_missions;
  const { data: pendingRows } = canAddMissions ? await db.from("missions").select("id, template_id").eq("profile_id", player.id).eq("needs_approval", true) : { data: [] };
  const pending = ((pendingRows ?? []) as Array<{ id: string; template_id: string }>).map((m) => ({ id: m.id, title: textByMode(byId.get(m.template_id)?.title, player.age_mode as AgeMode) || m.template_id }));
  const { data: transfersRows } = canView ? await db.from("transfer_reports").select("id, what, context_tag, worked, capability_id").eq("profile_id", player.id).eq("guardian_confirmed", false).order("created_at", { ascending: false }).limit(10) : { data: [] };
  const transfers = (transfersRows ?? []) as Array<{ id: string; what: string; context_tag: string; worked: boolean; capability_id: string }>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{player.display_name}</CardTitle><div className="flex gap-1"><Badge variant="secondary">{t(`modes.${player.age_mode}`)}</Badge><Badge variant="outline">{t("guardian.stage")}: {t(`stages.${player.incentive_stage}`)}</Badge>{player.game_intensity !== null && <Badge variant="muted">{t("guardian.intensity")}: {player.game_intensity}</Badge>}</div></div></CardHeader>
        <CardContent className="space-y-3">
          {recent.filter((m) => !m.dismissed).length === 0 ? <Alert>{t("guardian.empty_overview")}</Alert> : (
            <div className="space-y-1 text-sm">
              <div className="font-medium">{t("missions.history")}</div>
              {recent.filter((m) => !m.dismissed).map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
                  <span>{textByMode(byId.get(m.template_id)?.title, player.age_mode as AgeMode) || m.template_id}</span>
                  <span className="flex gap-1"><Badge variant="muted">{m.suggested_for}</Badge><Badge variant="secondary">{t(`missions.status.${m.status}`)}</Badge></span>
                </div>
              ))}
            </div>
          )}
          {player.login_code && <p className="text-sm text-muted-foreground">{t("auth.login_code")}: <code dir="ltr">{player.login_code}</code></p>}
          <div className="flex flex-wrap gap-2">
            {(link.is_creator || link.permissions.manage_settings) && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/settings`}>{t("nav.settings")}</Link></Button>}
            <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/guardians`}>{t("nav.guardians")}</Link></Button>
            {(link.is_creator || link.permissions.view_chat) && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/chat`}>{t("guardian.chat")}</Link></Button>}
            {canView && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/summary`}>{t("guardian.weekly")}</Link></Button>}
            {canAddMissions && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/missions/new`}>{t("guardian.add_mission")}</Link></Button>}
            {(link.is_creator || link.permissions.add_rewards) && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/rewards`}>{t("guardian.rewards")}</Link></Button>}
            <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/context`}>{t("guardian.context")}</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/suggestions`}>{t("guardian.suggestions")}</Link></Button>
            {(link.is_creator || link.permissions.view_planner || link.permissions.add_missions) && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/planner`}>{plannerContent.guardian.link}</Link></Button>}
            {(link.is_creator || link.permissions.view_planner) && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/mirror`}>{plannerContent.review.mirror_link}</Link></Button>}
            {player.age_mode === "child" && (link.is_creator || link.permissions.manage_settings) && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/pace`}>{plannerContent.guardian.pace_link}</Link></Button>}
            {player.age_mode === "child" && <Button asChild size="sm" variant="outline"><Link href={`/guardian/${player.id}/challenges`}>{t("guardian.challenges")}</Link></Button>}
          </div>
        </CardContent>
      </Card>
      {canAddMissions && <ApprovalsList missions={pending} />}
      {transfers.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">{t("guardian.transfers_pending")}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">{transfers.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"><span>{r.what} <Badge variant="muted">{r.context_tag}</Badge> {r.worked ? "نجح" : "لم ينجح"}</span><ConfirmTransferButton reportId={r.id} /></div>)}</CardContent></Card>
      )}
      {canView && <ObservationForm profileId={player.id} />}
      {(link.is_creator || link.permissions.manage_settings) && <Card><CardHeader><CardTitle className="text-base">{realMissions.more_support.button}</CardTitle></CardHeader><CardContent><MoreSupportForm profileId={player.id} /></CardContent></Card>}
      {mapView && <CapabilityMap view={mapView} readOnly />}
      {link.is_creator && player.age_mode === "child" && <AccountData profileId={player.id} canDelete childLabel />}
      {player.age_mode === "child" && link.is_creator && s && (
        <AgeTransitionForm profileId={player.id} to="teen" label={t("guardian.to_teen")} warning={t("guardian.transition_warning_teen")} />
      )}
      {!canManage && <p className="text-xs text-muted-foreground">صلاحياتك: {Object.entries(link.permissions).filter(([, v]) => v).map(([k]) => t(`permissions.${k}`)).join("، ") || t("common.none")}</p>}
    </div>
  );
}
