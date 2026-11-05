"use client";
import { useActionState } from "react";
import { decideSuggestion, type SuggestionActionResult } from "../suggestion-actions";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import { t } from "@/shared/i18n";
import content from "@content/adaptation.ar.json";
import capabilities from "@content/capabilities.ar.json";
import mechanics from "@content/mechanics.ar.json";

export type SuggestionRow = { id: string; type: string; setting_key: string | null; proposed_value: unknown; reason_short: string; expected_effect: string; audience: "owner" | "guardian"; decision: string | null; decided_at: string | null; created_at: string; expires_at: string };

const capName = (id: string) => (capabilities as unknown as Record<string, { name: string }>)[id]?.name ?? id;
const mechName = (id: string) => (mechanics as unknown as Record<string, { name: string }>)[id]?.name ?? id;

/** وصف القيمة المقترحة بلغة بشرية من content. */
export function describeValue(s: Pick<SuggestionRow, "type" | "setting_key" | "proposed_value">): string {
  const v = s.proposed_value as Record<string, unknown> | unknown[] | number | null;
  const L = content.suggestions.value_labels;
  if (s.setting_key === "daily_mission_count") return L.daily_mission_count.replace("{value}", String(v));
  if (s.setting_key === "focus_capabilities") return L.focus_capabilities.replace("{value}", (v as string[]).map(capName).join("، "));
  if (s.setting_key === "available_windows") return L.available_windows.replace("{value}", (v as Array<{ from: string; to: string }>).map((w) => `${w.from}–${w.to}`).join("، "));
  if (s.type === "try_mechanic") return L.mechanic.replace("{value}", mechName(String((v as { mechanic?: string })?.mechanic ?? "")));
  if (s.type === "request_more_support") return L.capability.replace("{value}", capName(String((v as { capability_id?: string })?.capability_id ?? "")));
  if (s.type === "real_mission_idea") return L.idea.replace("{value}", String((v as { idea?: string })?.idea ?? ""));
  return JSON.stringify(v);
}

const Err = ({ s }: { s: SuggestionActionResult | null }) => (s && !s.ok ? <p className="text-xs text-destructive">{s.error === "not_allowed" ? t("common.not_allowed") : `${t("common.error_generic")} (${s.error})`}</p> : null);

/** P18 / G11: اقتراحات التكيّف بسببها وأثرها، مع "طبّق" و"لا الآن" (5.8). */
export function SuggestionsPanel({ items, canDecide, childNote = false }: { items: SuggestionRow[]; canDecide: boolean; childNote?: boolean }) {
  const [s, act, pending] = useActionState(decideSuggestion, null);
  const open = items.filter((i) => !i.decision);
  const past = items.filter((i) => i.decision);
  return (
    <div className="space-y-3">
      <Alert className="text-sm">{content.suggestions.intro}{childNote ? ` ${content.suggestions.decided_by_guardian}` : ""}</Alert>
      {s?.ok && <Alert variant="success" className="text-sm">{(s.data as Record<string, unknown> | null)?.setting ? content.suggestions.applied : content.suggestions.rejected}</Alert>}
      {open.length === 0 && <p className="text-sm text-muted-foreground">{content.suggestions.empty}</p>}
      {open.map((i) => (
        <Card key={i.id}>
          <CardHeader><CardTitle className="text-base">{(content.suggestions.types as Record<string, string>)[i.type] ?? i.type}</CardTitle><CardDescription>{describeValue(i)}</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="font-medium">{content.suggestions.reason_label}:</span> {i.reason_short}</div>
            <div><span className="font-medium">{content.suggestions.expected_effect_label}:</span> {i.expected_effect}</div>
            {canDecide && (
              <form action={act} className="flex gap-2"><input type="hidden" name="id" value={i.id} />
                <Button type="submit" name="decision" value="accepted" size="sm" disabled={pending}>{content.suggestions.apply}</Button>
                <Button type="submit" name="decision" value="rejected" size="sm" variant="ghost" disabled={pending}>{content.suggestions.not_now}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      ))}
      <Err s={s} />
      {past.length > 0 && <div className="space-y-1 text-xs text-muted-foreground">{past.map((i) => <div key={i.id}><Badge variant="muted">{i.decision}</Badge> {(content.suggestions.types as Record<string, string>)[i.type] ?? i.type} · {describeValue(i)}</div>)}</div>}
    </div>
  );
}
