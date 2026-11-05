"use client";
import { useActionState } from "react";
import { transitionAgeMode } from "@/modules/accounts/actions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import { t } from "@/shared/i18n";

export function AgeTransitionForm({ profileId, to, label, warning }: { profileId: string; to: "teen" | "adult"; label: string; warning: string }) {
  const [state, action, pending] = useActionState(transitionAgeMode, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("guardian.mode_transition")}</CardTitle><CardDescription>{warning}</CardDescription></CardHeader>
      <CardContent>
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="profile_id" value={profileId} />
          <input type="hidden" name="to" value={to} />
          <Button type="submit" variant="outline" disabled={pending} onClick={(e) => { if (!confirm(warning)) e.preventDefault(); }}>{label}</Button>
          {state && (state.ok ? <Alert variant="success" className="py-2">تم</Alert> : <Alert variant="error" className="py-2">{state.error}</Alert>)}
        </form>
      </CardContent>
    </Card>
  );
}
