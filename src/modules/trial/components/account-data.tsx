"use client";
import { useActionState } from "react";
import { deleteAccount } from "../actions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";
import content from "@content/trial.ar.json";

/** 8.4: تصدير بياناتي وحذف الحساب. canDelete=false في وضع الطفل (الحذف للمربي المنشئ). */
export function AccountData({ profileId, canDelete, childLabel = false }: { profileId: string; canDelete: boolean; childLabel?: boolean }) {
  const [s, act, pending] = useActionState(deleteAccount, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{content.data.title}</CardTitle><CardDescription>{content.data.export_help}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Button asChild size="sm" variant="outline"><a href={`/api/export?profile=${profileId}`}>{content.data.export}</a></Button>
        {canDelete && (
          <form action={act} className="space-y-2 rounded-xl border border-destructive/40 p-3">
            <input type="hidden" name="profile_id" value={profileId} />
            <p className="text-xs text-muted-foreground">{content.data.delete_help}</p>
            <div className="space-y-1"><Label htmlFor="confirm">{content.data.delete_confirm_label}</Label><Input id="confirm" name="confirm" maxLength={10} className="max-w-40" /></div>
            <Button type="submit" size="sm" variant="destructive" disabled={pending}>{childLabel ? content.data.delete_child : content.data.delete}</Button>
            {s?.ok && <Alert variant="success" className="text-sm">{content.data.deleted}</Alert>}
            {s && !s.ok && <p className="text-xs text-destructive">{s.error === "not_allowed" ? t("common.not_allowed") : s.error === "confirm_required" ? content.data.delete_confirm_label : s.error}</p>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
