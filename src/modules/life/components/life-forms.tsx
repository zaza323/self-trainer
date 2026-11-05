"use client";
import { useActionState, useState } from "react";
import { createRealMission, submitTransferReport, confirmTransfer, addObservation, requestMoreSupport, approveMission, type LifeActionResult } from "../actions";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { t } from "@/shared/i18n";
import realMissions from "@content/real_missions.ar.json";
import observations from "@content/guardian_observations.ar.json";
import contextTags from "@content/context_tags.ar.json";
import mechanics from "@content/mechanics.ar.json";
import capabilities from "@content/capabilities.ar.json";
import { MECHANIC_IDS, CAPABILITY_IDS } from "@/shared/config";

const Err = ({ s }: { s: LifeActionResult | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{s.error === "mechanic_required" ? realMissions.mechanic_manual : s.error === "not_allowed" ? t("common.not_allowed") : `${t("common.error_generic")} (${s.error})`}</Alert> : null);
const CTX = Object.entries(contextTags).filter(([k]) => !k.startsWith("_") && k !== "in_app") as Array<[string, string]>;
const capName = (id: string) => (capabilities as unknown as Record<string, { name: string }>)[id]?.name ?? id;

/** G04 / MIS-2: مهمة واقعية (مرة واحدة أو متكررة للمربي). */
export function RealMissionForm({ profileId, isSelf, aiEnabled, extraContexts = [] }: { profileId: string; isSelf: boolean; aiEnabled: boolean; extraContexts?: string[] }) {
  const [s, act, pending] = useActionState(createRealMission, null);
  const [recurring, setRecurring] = useState(false);
  const [manual, setManual] = useState(!aiEnabled);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{isSelf ? realMissions.self_add_title : realMissions.guardian_add_title}</CardTitle><CardDescription>{aiEnabled ? realMissions.mechanic_auto : realMissions.mechanic_manual}</CardDescription></CardHeader>
      <CardContent>
        <form action={act} className="space-y-3">
          <input type="hidden" name="profile_id" value={profileId} />
          <div className="space-y-1"><Label htmlFor="title">{realMissions.title_label}</Label><Input id="title" name="title" required maxLength={200} list="ctx-list" /><datalist id="ctx-list">{extraContexts.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="space-y-1"><Label htmlFor="situation">{realMissions.situation_label}</Label><Input id="situation" name="situation" maxLength={600} /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="minutes">الدقائق</Label><Input id="minutes" name="minutes" type="number" dir="ltr" min={5} max={180} defaultValue={20} /></div>
            <div className="space-y-1">
              <Label htmlFor="mechanic">{realMissions.mechanic_label}</Label>
              {aiEnabled && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> أختار يدويًا</label>}
              {manual && <Select id="mechanic" name="mechanic" defaultValue="plan_ahead">{MECHANIC_IDS.map((m) => <option key={m} value={m}>{(mechanics as unknown as Record<string, { name: string }>)[m]?.name ?? m}</option>)}</Select>}
            </div>
          </div>
          {!isSelf && (
            <div className="space-y-2 rounded-xl border p-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recurring" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> {realMissions.recurring_label}</label>
              {recurring && (
                <>
                  <div className="flex flex-wrap gap-1 text-sm">{realMissions.days.map((d, i) => <label key={i} className="flex items-center gap-1 rounded-lg border px-2 py-1"><input type="checkbox" name="days" value={i} /> {d}</label>)}</div>
                  <div className="space-y-1"><Label htmlFor="time_local">{realMissions.time_label}</Label><Input id="time_local" name="time_local" type="time" dir="ltr" className="max-w-40" /></div>
                </>
              )}
            </div>
          )}
          <Err s={s} />
          {s?.ok && <Alert variant="success" className="text-sm">{isSelf ? "أُضيفت مهمتك." : "أُضيفت المهمة وستظهر ضمن اقتراحات اليوم."}</Alert>}
          <Button type="submit" disabled={pending}>{t("common.save")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** P11 تقرير النقل (LIFE-2): أين؟ ماذا فعلت؟ هل نجح؟ */
export function TransferForm({ missionId, capabilityId, extraContexts = [] }: { missionId: string | null; capabilityId: string; extraContexts?: string[] }) {
  const [s, act, pending] = useActionState(submitTransferReport, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{realMissions.transfer.title}</CardTitle><CardDescription>{realMissions.transfer.invite} — {capName(capabilityId)}</CardDescription></CardHeader>
      <CardContent>
        {s?.ok ? <Alert variant="success">{realMissions.transfer.thanks}</Alert> : (
          <form action={act} className="space-y-3">
            {missionId && <input type="hidden" name="mission_id" value={missionId} />}
            <input type="hidden" name="capability_id" value={capabilityId} />
            <div className="space-y-1"><Label htmlFor="context_tag">{realMissions.transfer.where}</Label>
              <Select id="context_tag" name="context_tag" defaultValue="home">{CTX.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              {extraContexts.length > 0 && <p className="text-xs text-muted-foreground">سياقاتك: {extraContexts.join("، ")}</p>}</div>
            <div className="space-y-1"><Label htmlFor="what">{realMissions.transfer.what}</Label><textarea id="what" name="what" required maxLength={500} rows={2} className="w-full rounded-xl border border-input bg-background p-3" /></div>
            <fieldset className="flex gap-3 text-sm"><legend className="mb-1 font-medium">{realMissions.transfer.worked}</legend><label className="flex items-center gap-1"><input type="radio" name="worked" value="true" defaultChecked /> {t("common.yes")}</label><label className="flex items-center gap-1"><input type="radio" name="worked" value="false" /> {t("common.no")}</label></fieldset>
            <Err s={s} />
            <Button type="submit" disabled={pending}>{realMissions.transfer.submit}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function ConfirmTransferButton({ reportId }: { reportId: string }) {
  const [s, act, pending] = useActionState(confirmTransfer, null);
  if (s?.ok) return <Badge variant="success">{realMissions.transfer.confirmed_by_guardian}</Badge>;
  return <form action={act}><input type="hidden" name="report_id" value={reportId} /><Button type="submit" size="sm" variant="outline" disabled={pending}>{realMissions.transfer.confirm}</Button><Err s={s} /></form>;
}

/** GUARD-3: ملاحظة مربٍ بصيغة محددة. */
export function ObservationForm({ profileId }: { profileId: string }) {
  const [s, act, pending] = useActionState(addObservation, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{realMissions.observation.title}</CardTitle><CardDescription>تُسجَّل كدليل بوزن المربي، لا كحكم.</CardDescription></CardHeader>
      <CardContent>
        <form action={act} className="space-y-2">
          <input type="hidden" name="profile_id" value={profileId} />
          <div className="space-y-1"><Label htmlFor="observation_type">{realMissions.observation.type_label}</Label>
            <Select id="observation_type" name="observation_type">{Object.entries(observations.types).map(([k, v]) => <option key={k} value={k}>{(v as { label: string }).label} — {capName((v as { capability: string }).capability)}</option>)}</Select></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="octx">{realMissions.transfer.where}</Label><Select id="octx" name="context_tag" defaultValue="home">{CTX.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
            <div className="space-y-1"><Label htmlFor="note_short">{realMissions.observation.note_label}</Label><Input id="note_short" name="note_short" maxLength={200} /></div>
          </div>
          <Err s={s} />
          {s?.ok && <span className="text-xs text-emerald-700">{realMissions.observation.saved}</span>}
          <Button type="submit" size="sm" disabled={pending}>{realMissions.observation.submit}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** GUARD-9 */
export function MoreSupportForm({ profileId }: { profileId: string }) {
  const [s, act, pending] = useActionState(requestMoreSupport, null);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="profile_id" value={profileId} />
      <div className="space-y-1"><Label htmlFor="cap">القدرة</Label><Select id="cap" name="capability_id">{CAPABILITY_IDS.map((c) => <option key={c} value={c}>{capName(c)}</option>)}</Select></div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{realMissions.more_support.button}</Button>
      {s?.ok && <span className="text-xs text-emerald-700">{realMissions.more_support.done}</span>}
      <Err s={s} />
    </form>
  );
}

/** MIS-2: موافقات المربي. */
export function ApprovalsList({ missions }: { missions: Array<{ id: string; title: string }> }) {
  const [s, act, pending] = useActionState(approveMission, null);
  if (missions.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{realMissions.pending_approvals}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {missions.map((m) => <form key={m.id} action={act} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"><span>{m.title}</span><input type="hidden" name="mission_id" value={m.id} /><Button type="submit" size="sm" disabled={pending}>{realMissions.approve}</Button></form>)}
        <Err s={s} />
      </CardContent>
    </Card>
  );
}
