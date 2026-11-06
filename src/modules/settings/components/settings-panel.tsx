"use client";
import { useActionState } from "react";
import { saveSetting, resetSetting, toggleLock, type SettingsActionResult } from "../actions";
import type { EffectiveSetting, SettingRow } from "../resolve";
import type { EditDecision } from "../permissions";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Select } from "@/shared/ui";
import { t } from "@/shared/i18n";
import type { AgeMode, CatalogEntry } from "@/shared/config";
import { CAPABILITY_IDS } from "@/shared/config";

export type SettingView = {
  key: string;
  entry: CatalogEntry;
  label: string;
  help: string;
  enumLabels: Record<string, string>;
  effective: EffectiveSetting;
  myRow: SettingRow | null;
  canEdit: EditDecision;
  canLock: EditDecision;
  whoSet: string;
};

export type SettingsPanelProps = {
  profileId: string;
  ageMode: AgeMode;
  role: "player" | "guardian";
  items: SettingView[];
  guardrails: string[];
  guardrailsIntro: string;
  capabilityNames: Record<string, string>;
  lockedHint: string;
};

function display(entry: CatalogEntry, value: unknown, enumLabels: Record<string, string>, capNames: Record<string, string>): string {
  if (value === null || value === undefined) return t("common.none");
  switch (entry.type) {
    case "bool": return value ? t("common.yes") : t("common.no");
    case "int_or_auto": return value === "auto" ? t("settings.auto") : String(value);
    case "enum_array": return (value as string[]).length ? (value as string[]).map((v) => enumLabels[v] ?? v).join("، ") : t("common.none");
    case "enum": case "enum_or_null": return enumLabels[String(value)] ?? String(value);
    case "capability_array": return (value as string[]).length ? (value as string[]).map((c) => capNames[c] ?? c).join("، ") : t("common.none");
    case "time_windows": return (value as Array<{ from: string; to: string }>).length ? (value as Array<{ from: string; to: string }>).map((w) => `${w.from}–${w.to}`).join("، ") : t("common.none");
    case "time_range": return `${(value as string[])[0]} → ${(value as string[])[1]}`;
    default: return String(value);
  }
}

function ValueInput({ entry, current, enumLabels, capNames }: { entry: CatalogEntry; current: unknown; enumLabels: Record<string, string>; capNames: Record<string, string> }) {
  switch (entry.type) {
    case "int":
      return <Input name="value" type="number" dir="ltr" min={entry.min} max={entry.max} step={1} defaultValue={typeof current === "number" ? current : ""} required className="max-w-32" />;
    case "int_or_null":
      return <Input name="value" type="number" dir="ltr" min={entry.min} max={entry.max} step={1} defaultValue={typeof current === "number" ? current : ""} placeholder={t("common.none")} className="max-w-32" />;
    case "int_or_auto":
      return <Input name="value" dir="ltr" defaultValue={current === "auto" || current === undefined ? "auto" : String(current)} placeholder="auto" className="max-w-32" aria-label={t("settings.auto")} />;
    case "enum_array": {
      const selected = new Set((current as string[]) ?? []);
      return (
        <div className="grid grid-cols-2 gap-1 text-sm">
          {entry.values.map((v) => (
            <label key={v} className="flex items-center gap-2 rounded-lg border p-2">
              <input type="checkbox" name="value" value={v} defaultChecked={selected.has(v)} /> {enumLabels[v] ?? v}
            </label>
          ))}
        </div>
      );
    }
    case "time_local_or_null":
      return <Input name="value" type="time" dir="ltr" defaultValue={typeof current === "string" ? current : ""} className="max-w-40" />;
    case "moment_windows": case "list": case "category_list":
      return <Input name="value" dir="ltr" defaultValue={JSON.stringify(current ?? null)} />;
    case "bool":
      return (
        <Select name="value" defaultValue={current ? "true" : "false"} className="max-w-32">
          <option value="true">{t("common.yes")}</option>
          <option value="false">{t("common.no")}</option>
        </Select>
      );
    case "enum":
      return (
        <Select name="value" defaultValue={String(current ?? "")}>
          {entry.values.map((v) => <option key={v} value={v}>{enumLabels[v] ?? v}</option>)}
        </Select>
      );
    case "enum_or_null":
      return (
        <Select name="value" defaultValue={current === null || current === undefined ? "" : String(current)}>
          <option value="">{t("common.none")}</option>
          {entry.values.map((v) => <option key={String(v)} value={String(v)}>{enumLabels[String(v)] ?? String(v)}</option>)}
        </Select>
      );
    case "capability_array": {
      const selected = new Set((current as string[]) ?? []);
      return (
        <div className="grid grid-cols-2 gap-1 text-sm">
          {CAPABILITY_IDS.map((c) => (
            <label key={c} className="flex items-center gap-2 rounded-lg border p-2">
              <input type="checkbox" name="value" value={c} defaultChecked={selected.has(c)} /> {capNames[c] ?? c}
            </label>
          ))}
          <p className="col-span-2 text-xs text-muted-foreground">حتى {entry.max_items} قدرات.</p>
        </div>
      );
    }
    case "time_windows":
      return <Input name="value" dir="ltr" defaultValue={JSON.stringify(current ?? [])} placeholder='[{"from":"16:00","to":"18:00"}]' />;
    case "time_local":
      return <Input name="value" type="time" dir="ltr" defaultValue={String(current ?? "")} required className="max-w-40" />;
    case "time_range": {
      const [a, b] = (current as string[]) ?? ["", ""];
      return (
        <div className="flex items-center gap-2">
          <Input name="value" type="time" dir="ltr" defaultValue={a} required className="max-w-32" />
          <span>→</span>
          <Input name="value" type="time" dir="ltr" defaultValue={b} required className="max-w-32" />
        </div>
      );
    }
  }
}

function Feedback({ state }: { state: SettingsActionResult | null }) {
  if (!state) return null;
  if (state.ok) return <span className="text-xs text-emerald-700">{t("settings.saved")}</span>;
  const msg = state.error === "not_allowed" ? t("common.not_allowed") : state.error === "invalid_value" || state.error.startsWith("must") || state.error.includes("range") ? t("common.invalid_value") : `${t("common.error_generic")} (${state.error})`;
  return <span className="text-xs text-destructive">{msg}</span>;
}

function SettingRowCard({ item, profileId, role, canLockInMode, capNames, lockedHint }: { item: SettingView; profileId: string; role: "player" | "guardian"; canLockInMode: boolean; capNames: Record<string, string>; lockedHint: string }) {
  const [saveState, saveAction, saving] = useActionState(saveSetting, null);
  const [resetState, resetAction, resetting] = useActionState(resetSetting, null);
  const [lockState, lockAction, locking] = useActionState(toggleLock, null);
  const eff = item.effective;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{item.label}</CardTitle>
            {item.help && <CardDescription>{item.help}</CardDescription>}
          </div>
          <div className="flex flex-wrap gap-1">
            {eff.locked ? <Badge variant="warning">{t("settings.locked")}</Badge> : <Badge variant="muted">{t("settings.unlocked")}</Badge>}
            <Badge variant="outline">{item.whoSet}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          <span className="text-muted-foreground">{t("settings.effective")}: </span>
          <span className="font-semibold">{display(item.entry, eff.value, item.enumLabels, capNames)}</span>
        </div>
        {eff.locked && role === "player" && <p className="text-xs text-amber-700">{lockedHint}</p>}
        {item.canEdit.allowed ? (
          <form action={saveAction} className="space-y-2">
            <input type="hidden" name="profile_id" value={profileId} />
            <input type="hidden" name="key" value={item.key} />
            <input type="hidden" name="role" value={role} />
            <ValueInput entry={item.entry} current={item.myRow?.value ?? eff.value} enumLabels={item.enumLabels} capNames={capNames} />
            {role === "guardian" && canLockInMode && item.canLock.allowed && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="lock" defaultChecked={Boolean(item.myRow?.locked)} /> {t("common.lock")}</label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={saving}>{t("common.save")}</Button>
              <Feedback state={saveState} />
            </div>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">{t("settings.cannot_edit")}</p>
        )}
        {item.canEdit.allowed && item.myRow && (
          <div className="flex flex-wrap items-center gap-2">
            <form action={resetAction}>
              <input type="hidden" name="profile_id" value={profileId} />
              <input type="hidden" name="key" value={item.key} />
              <input type="hidden" name="role" value={role} />
              <Button type="submit" size="sm" variant="ghost" disabled={resetting}>{t("common.reset_to_default")}</Button>
            </form>
            <Feedback state={resetState} />
            {role === "guardian" && item.myRow.locked && (
              <form action={lockAction}>
                <input type="hidden" name="profile_id" value={profileId} />
                <input type="hidden" name="key" value={item.key} />
                <input type="hidden" name="locked" value="false" />
                <Button type="submit" size="sm" variant="outline" disabled={locking}>{t("common.unlock")}</Button>
              </form>
            )}
            <Feedback state={lockState} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const canLockInMode = props.items.some((i) => i.canLock.allowed);
  return (
    <div className="space-y-3">
      {props.items.map((item) => (
        <SettingRowCard key={item.key} item={item} profileId={props.profileId} role={props.role} canLockInMode={canLockInMode} capNames={props.capabilityNames} lockedHint={props.lockedHint} />
      ))}
      <Card>
        <CardHeader><CardTitle className="text-base">{t("settings.guardrails")}</CardTitle><CardDescription>{props.guardrailsIntro}</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-1">
          {props.guardrails.map((g) => <Badge key={g} variant="muted" dir="ltr">{g}</Badge>)}
        </CardContent>
      </Card>
    </div>
  );
}
