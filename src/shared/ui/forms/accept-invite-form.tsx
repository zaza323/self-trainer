"use client";
import { useActionState } from "react";
import Link from "next/link";
import { acceptGuardianInvite } from "@/modules/guardian/actions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";

export function AcceptInviteForm({ code }: { code?: string }) {
  const [state, action, pending] = useActionState(acceptGuardianInvite, null);
  return (
    <Card>
      <CardHeader><CardTitle>{t("guardians.accept_title")}</CardTitle><CardDescription>أدخل رمز الدعوة الذي أرسله لك صاحب الحساب.</CardDescription></CardHeader>
      <CardContent>
        {state?.ok ? (
          <div className="space-y-3"><Alert variant="success">{t("guardians.accepted")}</Alert><Button asChild><Link href="/guardian">{t("guardian.dashboard")}</Link></Button></div>
        ) : (
          <form action={action} className="space-y-3">
            <div className="space-y-1"><Label htmlFor="code">{t("guardians.code")}</Label><Input id="code" name="code" dir="ltr" defaultValue={code ?? ""} required className="font-mono" /></div>
            {state && !state.ok && <Alert variant="error">{state.error === "invite_invalid" ? "الدعوة غير صالحة أو منتهية." : state.error === "cannot_self_guardian" ? "لا يمكنك أن تكون مربيًا لنفسك." : `${t("common.error_generic")} (${state.error})`}</Alert>}
            <Button type="submit" disabled={pending}>{t("guardians.accept")}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
