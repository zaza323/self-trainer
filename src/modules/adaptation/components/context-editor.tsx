"use client";
import { useActionState } from "react";
import { addContext, removeContext, decideContextSuggestion, type ContextActionResult } from "../actions";
import type { ContextField, PersonalContext } from "../personal-context";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";
import content from "@content/personal_context.ar.json";

const REASONS: Record<string, string> = { health: "لا تُحفظ معلومات صحية.", precise_location: "لا تُحفظ مواقع دقيقة.", phone: "لا تُحفظ أرقام هواتف.", max_items: "بلغت الحد الأقصى لهذا الحقل.", too_long: "النص طويل.", empty: "اكتب شيئًا.", not_allowed: t("common.not_allowed") };
const Err = ({ s }: { s: ContextActionResult | null }) => (s && !s.ok ? <span className="text-xs text-destructive">{REASONS[s.error] ?? `${t("common.error_generic")} (${s.error})`}</span> : null);

function FieldEditor({ profileId, field, items, readOnly }: { profileId: string; field: ContextField; items: string[]; readOnly: boolean }) {
  const [a, addAct, adding] = useActionState(addContext, null);
  const [, rmAct] = useActionState(removeContext, null);
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="font-medium">{(content.fields as Record<string, string>)[field]}</div>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
        {items.map((v) => (
          <form key={v} action={rmAct} className="inline-flex"><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value={field} /><input type="hidden" name="value" value={v} />
            <Badge variant="secondary">{v}{!readOnly && <button type="submit" aria-label={`${t("common.remove")} ${v}`} className="ms-1 text-xs">×</button>}</Badge></form>
        ))}
      </div>
      {!readOnly && (
        <form action={addAct} className="flex gap-2">
          <input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value={field} />
          <Input name="value" maxLength={80} aria-label={(content.fields as Record<string, string>)[field]} />
          <Button type="submit" size="sm" variant="outline" disabled={adding}>+</Button>
          <Err s={a} />
        </form>
      )}
    </div>
  );
}

/** P03 / G12 (ADAPT-1، ADAPT-2) */
export function ContextEditor({ profileId, context, suggestions, readOnly = false }: { profileId: string; context: PersonalContext; suggestions: Array<{ id: string; field: ContextField; value: string }>; readOnly?: boolean }) {
  const [, decideAct, deciding] = useActionState(decideContextSuggestion, null);
  return (
    <div className="space-y-3">
      <Alert className="text-sm">{content.intro}</Alert>
      <p className="text-xs text-muted-foreground">{content.forbidden_notice}</p>
      {!readOnly && suggestions.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">{content.suggestions_title}</CardTitle><CardDescription>لا يُحفظ إلا بموافقتك.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map((s) => (
              <form key={s.id} action={decideAct} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <span>{(content.fields as Record<string, string>)[s.field]}: <strong>{s.value}</strong></span>
                <span className="flex gap-1"><input type="hidden" name="suggestion_id" value={s.id} /><Button type="submit" name="decision" value="accepted" size="sm" disabled={deciding}>{content.accept}</Button><Button type="submit" name="decision" value="rejected" size="sm" variant="ghost" disabled={deciding}>{content.reject}</Button></span>
              </form>
            ))}
          </CardContent></Card>
      )}
      {(["interests", "routine", "free_windows", "contexts"] as ContextField[]).map((f) => <FieldEditor key={f} profileId={profileId} field={f} items={context[f]} readOnly={readOnly} />)}
    </div>
  );
}

/** P03 (5.1 خطوة 3): سؤالان اختياريان عند الانضمام. */
export function OnboardingContext({ profileId }: { profileId: string }) {
  const [a, addInterest, p1] = useActionState(addContext, null);
  const [b, addWindow, p2] = useActionState(addContext, null);
  return (
    <div className="space-y-3">
      <Alert className="text-sm">{content.intro}</Alert>
      <form action={addInterest} className="space-y-1"><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value="interests" /><Label htmlFor="i">{content.onboarding.interest}</Label><div className="flex gap-2"><Input id="i" name="value" maxLength={80} /><Button type="submit" size="sm" variant="outline" disabled={p1}>{t("common.save")}</Button></div>{a?.ok && <span className="text-xs text-emerald-700">✓</span>}<Err s={a} /></form>
      <form action={addWindow} className="space-y-1"><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value="free_windows" /><Label htmlFor="w">{content.onboarding.free_window}</Label><div className="flex gap-2"><Input id="w" name="value" maxLength={80} /><Button type="submit" size="sm" variant="outline" disabled={p2}>{t("common.save")}</Button></div>{b?.ok && <span className="text-xs text-emerald-700">✓</span>}<Err s={b} /></form>
    </div>
  );
}
