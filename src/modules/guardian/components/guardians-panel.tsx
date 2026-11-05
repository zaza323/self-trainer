"use client";
import { useActionState } from "react";
import { createGuardianInvite, updateGuardianLink, removeGuardianLink } from "../actions";
import type { GuardianLinkRow, GuardianInviteRow } from "@/shared/db/types";
import { GUARDIAN_PERMISSIONS, GUARDIAN_RELATIONS } from "@/shared/config/permissions";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { t } from "@/shared/i18n";
import type { AgeMode } from "@/shared/config";

type Props = {
  playerId: string;
  ageMode: AgeMode;
  currentUserId: string;
  canManage: boolean;
  links: GuardianLinkRow[];
  invites: GuardianInviteRow[];
  guardianNames: Record<string, string>;
};

function errorText(e: string) {
  const map: Record<string, string> = {
    last_alert_guardian: t("guardians.last_alert_guardian"),
    creator_cannot_be_removed: "رابط المربي المنشئ لا يُزال.",
    not_allowed: t("common.not_allowed"),
  };
  return map[e] ?? `${t("common.error_generic")} (${e})`;
}

function PermissionChecks({ defaults, disabled }: { defaults?: Partial<Record<string, boolean>>; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
      {GUARDIAN_PERMISSIONS.map((p) => (
        <label key={p} className="flex items-center gap-2 rounded-lg border p-2">
          <input type="checkbox" name={`perm_${p}`} defaultChecked={defaults?.[p] ?? false} disabled={disabled} /> {t(`permissions.${p}`)}
        </label>
      ))}
    </div>
  );
}

function LinkCard({ link, name, canManage, isMe }: { link: GuardianLinkRow; name: string; canManage: boolean; isMe: boolean }) {
  const [upd, updAction, updating] = useActionState(updateGuardianLink, null);
  const [rem, remAction, removing] = useActionState(removeGuardianLink, null);
  const editable = canManage && link.status === "active";
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{name}{isMe ? ` (${t("settings.you")})` : ""}</CardTitle>
          <div className="flex gap-1">
            {link.is_creator && <Badge>{t("guardians.creator")}</Badge>}
            <Badge variant={link.status === "active" ? "success" : "muted"}>{link.status === "active" ? t("guardians.status_active") : t("guardians.status_removed")}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={updAction} className="space-y-2">
          <input type="hidden" name="link_id" value={link.id} />
          <div className="space-y-1">
            <Label>{t("guardians.relation")}</Label>
            <Select name="relation" defaultValue={link.relation} disabled={!editable} className="max-w-48">
              {GUARDIAN_RELATIONS.map((r) => <option key={r} value={r}>{t(`relations.${r}`)}</option>)}
            </Select>
          </div>
          <Label>{t("guardians.permissions")}</Label>
          <PermissionChecks defaults={link.permissions} disabled={!editable || link.is_creator} />
          {editable && !link.is_creator && (
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={updating}>{t("common.save")}</Button>
              {upd && (upd.ok ? <span className="text-xs text-emerald-700">{t("settings.saved")}</span> : <span className="text-xs text-destructive">{errorText(upd.error)}</span>)}
            </div>
          )}
          {link.is_creator && <p className="text-xs text-muted-foreground">المنشئ يملك كل الصلاحيات ولا يُزال.</p>}
        </form>
        {editable && !link.is_creator && (
          <form action={remAction} className="flex items-center gap-2">
            <input type="hidden" name="link_id" value={link.id} />
            <Button type="submit" size="sm" variant="destructive" disabled={removing}>{t("common.remove")}</Button>
            {rem && !rem.ok && <span className="text-xs text-destructive">{errorText(rem.error)}</span>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function InviteForm({ playerId, ageMode }: { playerId: string; ageMode: AgeMode }) {
  const [state, action, pending] = useActionState(createGuardianInvite, null);
  const defaults = ageMode === "adult" ? { view_progress: true } : { view_progress: true, receive_alerts: ageMode === "child" };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("guardians.invite")}</CardTitle><CardDescription>تحدد الصفة والصلاحيات الآن، وتستطيع تغييرها لاحقًا.</CardDescription></CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="player_id" value={playerId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="relation">{t("guardians.relation")}</Label>
              <Select id="relation" name="relation" defaultValue="mother">
                {GUARDIAN_RELATIONS.map((r) => <option key={r} value={r}>{t(`relations.${r}`)}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">{t("auth.email")} (اختياري)</Label>
              <Input id="email" name="email" type="email" dir="ltr" />
            </div>
          </div>
          <Label>{t("guardians.permissions")}</Label>
          <PermissionChecks defaults={defaults} />
          <Button type="submit" disabled={pending}>{t("guardians.invite")}</Button>
          {state && state.ok && state.code && (
            <Alert variant="success">
              {t("guardians.code")}: <code dir="ltr" className="font-mono text-base">{state.code}</code>
              <div className="text-xs">{t("guardians.share_code")}</div>
            </Alert>
          )}
          {state && !state.ok && <Alert variant="error">{errorText(state.error)}</Alert>}
        </form>
      </CardContent>
    </Card>
  );
}

export function GuardiansPanel({ playerId, ageMode, currentUserId, canManage, links, invites, guardianNames }: Props) {
  const active = links.filter((l) => l.status !== "removed");
  return (
    <div className="space-y-4">
      {active.length === 0 && <Alert>{t("guardians.no_guardians")}</Alert>}
      {active.map((l) => (
        <LinkCard key={l.id} link={l} name={guardianNames[l.guardian_id] ?? t(`relations.${l.relation}`)} canManage={canManage} isMe={l.guardian_id === currentUserId} />
      ))}
      {canManage && invites.filter((i) => !i.accepted_at && new Date(i.expires_at) > new Date()).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("guardians.pending_invites")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {invites.filter((i) => !i.accepted_at && new Date(i.expires_at) > new Date()).map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
                <span>{t(`relations.${i.relation}`)}{i.email ? ` · ${i.email}` : ""}</span>
                <code dir="ltr" className="font-mono">{i.code}</code>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {canManage && <InviteForm playerId={playerId} ageMode={ageMode} />}
    </div>
  );
}
