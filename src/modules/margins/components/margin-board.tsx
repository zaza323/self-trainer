import type { SupabaseClient } from "@supabase/supabase-js";
import { margins, type AgeMode } from "@/shared/config";
import { resolveFor, marginLog, historyModeOf } from "../service";
import { basisText } from "../rules";
import { MarginControl, MarginRuleRow } from "./margin-control";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/shared/ui";
import content from "@content/margins.ar.json";

type Props = { db: SupabaseClient; profileId: string; mode: AgeMode; viewerId: string; canSet: boolean; canLock: boolean; children?: React.ReactNode };
const keyLabel = (k: string) => k.replace(/^(title|tpl|cap|proj):/, "");

/** G17 + G18 (وللمتدرب في teen/adult على مهامه): الهامش لكل مهمة مفتوحة، ثم سجل التعديلات والقواعد الصريحة ووضع التوصية. */
export async function MarginBoard({ db, profileId, mode, viewerId, canSet, canLock, children }: Props) {
  const now = new Date(), ui = content.ui, b = margins.bounds_min[mode];
  const [{ data: ms }, { data: ts }, log, historyMode] = await Promise.all([
    db.from("missions").select("id").eq("profile_id", profileId).in("status", ["suggested", "chosen", "planned"]).eq("dismissed", false).order("created_at", { ascending: false }).limit(margins.ui.list_limit),
    db.from("planner_tasks").select("id").eq("profile_id", profileId).eq("status", "open").is("parent_task_id", null).order("due_date", { ascending: true, nullsFirst: false }).limit(margins.ui.list_limit),
    marginLog(db, profileId, margins.ui.log_limit),
    historyModeOf(db, profileId),
  ]);
  const subjects = [
    ...((ms ?? []) as Array<{ id: string }>).map((m) => ({ type: "mission" as const, id: m.id })),
    ...((ts ?? []) as Array<{ id: string }>).map((t) => ({ type: "planner_task" as const, id: t.id })),
  ];
  const resolved = (await Promise.all(subjects.map((x) => resolveFor(db, x.type, x.id, now, { viewerId })))).filter((r) => r !== null);
  return (
    <div className="space-y-4">
      {canSet && (
        <Card><CardHeader><CardTitle className="text-base">{ui.title}</CardTitle></CardHeader><CardContent className="space-y-2">
          {!resolved.length ? <p className="text-sm text-muted-foreground">{ui.no_events}</p> : resolved.map(({ ctx, view }) => (
            <MarginControl key={`${ctx.type}:${ctx.id}`} subjectType={ctx.type} subjectId={ctx.id} title={ctx.title} current={view.margin_min} systemDefault={view.system_default}
              basis={basisText({ basis: view.basis, detail: view.detail })} sourceLabel={view.set_by_label} step={margins.step_min} min={b.min} max={b.max}
              reasons={margins.reason_codes} canLock={canLock} locked={view.locked} />
          ))}
        </CardContent></Card>
      )}
      <Card><CardHeader><CardTitle className="text-base">{ui.rules_title}</CardTitle></CardHeader><CardContent className="space-y-2">
        {!log.rules.length ? <p className="text-sm text-muted-foreground">{ui.no_rules}</p> : log.rules.map((r) => (
          canSet ? <MarginRuleRow key={r.id} id={r.id} label={keyLabel(r.similarity_key)} minutes={r.margin_min} step={margins.step_min} min={b.min} max={b.max} />
            : <div key={r.id} className="flex items-center justify-between rounded-xl border p-3 text-sm"><span>{keyLabel(r.similarity_key)}</span><Badge variant="secondary">{r.margin_min} {ui.minutes}</Badge></div>
        ))}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{ui.mode_title}</CardTitle></CardHeader><CardContent className="text-sm">{(content.history_modes as Record<string, string>)[historyMode]}</CardContent></Card>
      {children}
      <Card><CardHeader><CardTitle className="text-base">{ui.log_title}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
        {!log.events.length ? <p className="text-muted-foreground">{ui.no_events}</p> : log.events.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <span dir="ltr">{e.created_at.slice(0, 10)}</span>
            <span>{e.system_default_min} ← {e.set_min} {ui.minutes}</span>
            <Badge variant="muted">{(content.apply_scopes as Record<string, string>)[e.apply_scope]}</Badge>
            {e.reason_code && <Badge variant="secondary">{(content.reasons as Record<string, string>)[e.reason_code] ?? e.reason_code}</Badge>}
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}
