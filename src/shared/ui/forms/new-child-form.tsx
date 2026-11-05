"use client";
import { useActionState } from "react";
import { createChildProfile } from "@/modules/accounts/actions";
import { GUARDIAN_RELATIONS } from "@/shared/config/permissions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { t } from "@/shared/i18n";

export function NewChildForm({ policy, childExplainers }: { policy: { policy_version: string; title: string; summary: string[] }; childExplainers: { what: string; ai: string; who: string } }) {
  const [state, action, pending] = useActionState(createChildProfile, null);
  return (
    <form action={action} className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{t("guardian.new_child")}</CardTitle><CardDescription>{t("mode_desc.child")}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1"><Label htmlFor="display_name">{t("guardian.child_name")}</Label><Input id="display_name" name="display_name" required maxLength={60} /></div>
          <div className="space-y-1"><Label htmlFor="login_code">{t("guardian.login_code")}</Label><Input id="login_code" name="login_code" dir="ltr" required pattern="[A-Za-z0-9_-]{3,24}" autoComplete="off" /></div>
          <div className="space-y-1"><Label htmlFor="password">{t("guardian.child_password")}</Label><Input id="password" name="password" type="password" dir="ltr" required minLength={6} autoComplete="new-password" /></div>
          <div className="space-y-1">
            <Label htmlFor="relation">{t("guardian.your_relation")}</Label>
            <Select id="relation" name="relation" defaultValue="mother">{GUARDIAN_RELATIONS.map((r) => <option key={r} value={r}>{t(`relations.${r}`)}</option>)}</Select>
          </div>
          <div className="space-y-1"><Label htmlFor="timezone">{t("onboarding.timezone")}</Label><Input id="timezone" name="timezone" dir="ltr" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Amman"} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">ما سيُقال للطفل بلغته</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm"><p>{childExplainers.what}</p><p>{childExplainers.ai}</p><p>{childExplainers.who}</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{policy.title}</CardTitle><CardDescription>الإصدار {policy.policy_version}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <ul className="list-disc space-y-1 pe-5 text-sm">{policy.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" name="consent" required className="mt-1" /> {t("guardian.consent_check")}</label>
          {state && !state.ok && <Alert variant="error">{t("common.error_generic")} ({state.error})</Alert>}
          <Button type="submit" className="w-full" disabled={pending}>{t("guardian.create_child")}</Button>
        </CardContent>
      </Card>
    </form>
  );
}
