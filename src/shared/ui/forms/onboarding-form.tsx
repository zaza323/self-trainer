"use client";
import { useActionState, useState } from "react";
import { createOwnProfile } from "@/modules/accounts/actions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";
import type { AgeMode } from "@/shared/config";

type Choice = "teen" | "adult" | "guardian";
type ByMode = Record<AgeMode, string>;

export function OnboardingForm({ explainers }: { explainers: { what: ByMode; ai: ByMode; who: ByMode; guardrails: string; noDiagnosis: string } }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [state, action, pending] = useActionState(createOwnProfile, null);
  const mode: AgeMode | null = choice === "teen" || choice === "adult" ? choice : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-2xl">{t("onboarding.title")}</CardTitle><CardDescription>{t("onboarding.subtitle")}</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {(["teen", "adult", "guardian"] as Choice[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChoice(c)}
              className={`rounded-xl border p-4 text-start transition-colors ${choice === c ? "border-primary bg-secondary" : "border-border hover:bg-muted"}`}
              aria-pressed={choice === c}
            >
              <div className="font-semibold">{c === "guardian" ? t("onboarding.guardian_self") : `${t("onboarding.player_self")} (${t(`modes.${c}`)})`}</div>
              <div className="text-sm text-muted-foreground">{t(`mode_desc.${c}`)}</div>
            </button>
          ))}
          <p className="text-xs text-muted-foreground">{t("mode_desc.child")} — يُنشأ من لوحة المربي.</p>
        </CardContent>
      </Card>

      {choice && (
        <Card>
          <CardHeader><CardTitle>{choice === "guardian" ? t("modes.guardian") : t(`modes.${choice}`)}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {mode && (
              <div className="space-y-2 text-sm leading-relaxed">
                <p>{explainers.what[mode]}</p>
                <Alert>{explainers.ai[mode]}</Alert>
                <Alert>{explainers.who[mode]}</Alert>
                <p className="text-muted-foreground">{explainers.noDiagnosis}</p>
                <p className="text-muted-foreground">{explainers.guardrails}</p>
              </div>
            )}
            <form action={action} className="space-y-3">
              <input type="hidden" name="kind" value={choice === "guardian" ? "guardian" : "player"} />
              {mode && <input type="hidden" name="age_mode" value={mode} />}
              <div className="space-y-1"><Label htmlFor="display_name">{t("onboarding.display_name")}</Label><Input id="display_name" name="display_name" required maxLength={60} /></div>
              <div className="space-y-1"><Label htmlFor="timezone">{t("onboarding.timezone")}</Label><Input id="timezone" name="timezone" dir="ltr" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Amman"} /></div>
              {state && !state.ok && <Alert variant="error">{t("common.error_generic")} ({state.error})</Alert>}
              <Button type="submit" className="w-full" disabled={pending}>{t("onboarding.create")}</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
