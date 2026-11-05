"use client";
import Link from "next/link";
import { useActionState } from "react";
import { createChallenge, joinByCode, autoMatchAction, leaveChallenge, approveChallengeJoin, refreshBoard, type ChallengeActionResult } from "../actions";
import type { ChallengeRow, ParticipantRow } from "../service";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { t } from "@/shared/i18n";
import content from "@content/challenges.ar.json";
import { game } from "@/shared/config";

const Err = ({ s }: { s: ChallengeActionResult | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{(content.refusals as Record<string, string>)[s.error] ?? (s.error === "not_allowed" ? t("common.not_allowed") : `${t("common.error_generic")} (${s.error})`)}</Alert> : null);

export type ChallengeListItem = ChallengeRow & { title: string; members: number; mine: "member" | "pending" | "left" | null };

/** P21 التحديات: الانضمام برمز، المطابقة التلقائية، الإنشاء بدعوة. */
export function ChallengesPanel({ items, templates, canCreate, canAutoMatch }: { items: ChallengeListItem[]; templates: Array<{ id: string; version: number; title: string }>; canCreate: boolean; canAutoMatch: boolean }) {
  const [j, joinAct, joining] = useActionState(joinByCode, null);
  const [c, createAct, creating] = useActionState(createChallenge, null);
  const [a, matchAct, matching] = useActionState(async () => autoMatchAction(), null);
  return (
    <div className="space-y-4">
      <Alert className="text-sm">{content.intro}</Alert>
      <Card><CardHeader><CardTitle className="text-base">{content.join.title}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <form action={joinAct} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label htmlFor="code">{content.join.code_label}</Label><Input id="code" name="code" dir="ltr" maxLength={12} className="max-w-40 uppercase" required /></div>
            <Button type="submit" size="sm" disabled={joining}>{content.join.submit}</Button>
          </form>
          {j?.ok && <Alert variant="success" className="text-sm">{j.data === "pending" ? content.join.pending_guardian : content.join.joined}</Alert>}
          <Err s={j} />
          {canAutoMatch && <form action={matchAct}><Button type="submit" size="sm" variant="outline" disabled={matching}>{content.join.auto_match}</Button><p className="mt-1 text-xs text-muted-foreground">{content.join.auto_match_hint}</p><Err s={a} /></form>}
        </CardContent></Card>
      {canCreate && (
        <Card><CardHeader><CardTitle className="text-base">{content.create.title}</CardTitle><CardDescription>{game.challenges.min_participants}–{game.challenges.max_participants} متدربين، {game.challenges.duration_days} أيام، الانضمام خلال {game.challenges.start_window_hours} ساعة.</CardDescription></CardHeader>
          <CardContent><form action={createAct} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label htmlFor="tpl">{content.create.template_label}</Label><Select id="tpl" name="template_id" onChange={(e) => { const v = e.target.selectedOptions[0]?.dataset.version; (e.target.form?.elements.namedItem("version") as HTMLInputElement | null)?.setAttribute("value", v ?? "1"); }}>{templates.map((x) => <option key={`${x.id}:${x.version}`} value={x.id} data-version={x.version}>{x.title}</option>)}</Select></div>
            <input type="hidden" name="version" value={templates[0]?.version ?? 1} />
            <Button type="submit" size="sm" disabled={creating || templates.length === 0}>{content.create.submit}</Button>
          </form><Err s={c} /></CardContent></Card>
      )}
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
        {items.map((x) => (
          <Card key={x.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div><strong>{x.title}</strong> <Badge variant="secondary">{content.board.status[x.status]}</Badge> {x.mine === "pending" && <Badge variant="warning">{content.join.pending_guardian}</Badge>}<div className="text-xs text-muted-foreground">{x.members} مشاركين · {content.board.ends} {new Date(x.ends_at).toLocaleDateString("ar")}</div></div>
            <Button asChild size="sm" variant="outline"><Link href={`/app/challenges/${x.id}`}>{content.board.title}</Link></Button>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}

export type ScoreRow = { profile_id: string; attempts_pts: number; shown_pts: number; transfer_pts: number; improvement_pts: number; total: number; rank: number; badges: string[] };

/** P22 لوحة التحدي ونتيجته مع الأوسمة — للمشاركين فقط. */
export function ChallengeBoard({ challenge, title, participants, scores, myProfileId }: { challenge: ChallengeRow; title: string; participants: ParticipantRow[]; scores: ScoreRow[]; myProfileId: string }) {
  const [l, leaveAct, leaving] = useActionState(leaveChallenge, null);
  const [, refreshAct, refreshing] = useActionState(refreshBoard, null);
  const c = content.board.columns;
  const byId = new Map(participants.map((p) => [p.profile_id, p]));
  const rows = [...scores].sort((a, b) => a.rank - b.rank);
  const me = byId.get(myProfileId);
  return (
    <div className="space-y-3">
      <Card><CardHeader><CardTitle className="text-base">{challenge.status === "finished" ? content.finished_title : content.board.title}: {title}</CardTitle>
        <CardDescription>{content.board.status[challenge.status]} · {content.board.ends} {new Date(challenge.ends_at).toLocaleDateString("ar")} · {content.board.window} {new Date(challenge.join_until).toLocaleString("ar")}</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>{content.board.invite_code}: <code dir="ltr" className="rounded bg-muted px-2 py-0.5">{challenge.invite_code}</code></div>
          {rows.length === 0 ? <p className="text-muted-foreground">{content.board.no_scores}</p> : (
            <div className="overflow-x-auto"><table className="w-full"><thead><tr className="text-xs text-muted-foreground"><th className="p-1 text-start">{c.rank}</th><th className="p-1 text-start">{c.name}</th><th className="p-1">{c.attempts}</th><th className="p-1">{c.shown}</th><th className="p-1">{c.transfer}</th><th className="p-1">{c.improvement}</th><th className="p-1">{c.total}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.profile_id} className={r.profile_id === myProfileId ? "bg-secondary" : ""}>
                  <td className="p-1">{r.rank}</td>
                  <td className="p-1">{byId.get(r.profile_id)?.display_name ?? "—"}{r.profile_id === myProfileId && <span className="ms-1 text-xs text-muted-foreground">({content.board.you})</span>} {r.badges.map((b) => <Badge key={b} variant="success" className="ms-1">{(content.badges as Record<string, string>)[b] ?? b}</Badge>)}</td>
                  <td className="p-1 text-center">{r.attempts_pts}</td><td className="p-1 text-center">{r.shown_pts}</td><td className="p-1 text-center">{r.transfer_pts}</td><td className="p-1 text-center">{r.improvement_pts}</td><td className="p-1 text-center font-semibold">{r.total}</td>
                </tr>
              ))}</tbody></table></div>
          )}
          <p className="text-xs text-muted-foreground">{content.board.ties_share_rank}</p>
          <div className="flex gap-2">
            <form action={refreshAct}><input type="hidden" name="challenge_id" value={challenge.id} /><Button type="submit" size="sm" variant="outline" disabled={refreshing}>↻</Button></form>
            {me && !me.left_at && challenge.status !== "finished" && <form action={leaveAct}><input type="hidden" name="challenge_id" value={challenge.id} /><Button type="submit" size="sm" variant="ghost" disabled={leaving}>{content.board.leave}</Button></form>}
          </div>
          {l?.ok && <Alert className="text-sm">{content.board.left}</Alert>}
          <Err s={l} />
        </CardContent></Card>
    </div>
  );
}

/** G13: موافقة المربي على تحديات الطفل. */
export function GuardianChallengeApprovals({ pending }: { pending: Array<{ challenge_id: string; profile_id: string; title: string; display_name: string }> }) {
  const [s, act, pendingState] = useActionState(approveChallengeJoin, null);
  return (
    <Card><CardHeader><CardTitle className="text-base">{content.guardian.title}</CardTitle><CardDescription>{content.guardian.pending}</CardDescription></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {pending.length === 0 && <p className="text-muted-foreground">{content.guardian.none}</p>}
        {pending.map((p) => (
          <form key={`${p.challenge_id}:${p.profile_id}`} action={act} className="flex items-center justify-between gap-2 rounded-lg border p-2">
            <span>{p.display_name} → {p.title}</span>
            <input type="hidden" name="challenge_id" value={p.challenge_id} /><input type="hidden" name="profile_id" value={p.profile_id} />
            <Button type="submit" size="sm" disabled={pendingState}>{content.guardian.approve}</Button>
          </form>
        ))}
        {s?.ok && <Alert variant="success" className="text-sm">{content.guardian.approved}</Alert>}
        <Err s={s} />
      </CardContent></Card>
  );
}
