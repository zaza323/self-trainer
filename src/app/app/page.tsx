import Link from "next/link";
import { getSession } from "@/modules/accounts";
import { getGoals, nearestActiveGoal } from "@/modules/goals";
import { GoalChain } from "@/modules/goals/components/goal-chain";
import { ensureDailySuggestions } from "@/modules/engine";
import { listMissions, todayIn, OPEN_STATUSES } from "@/modules/missions";
import { loadActiveTemplates, textByMode, fillVariables } from "@/modules/library";
import { effective } from "@/modules/settings";
import { createClient } from "@/shared/db/server";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import { t } from "@/shared/i18n";
import explainers from "@content/explainers.ar.json";
import { getGameView } from "@/modules/game";
import { SpacePanel } from "@/modules/game/components/space-panel";
import { game } from "@/shared/config";
import messagesContent from "@content/companion_messages.ar.json";
import realMissions from "@content/real_missions.ar.json";
import type { AgeMode } from "@/shared/config";

/** P06 الرئيسية (5.2 خطوة 1): الغاية القريبة + 1–3 مهام مقترحة. */
export default async function HomePage() {
  const s = (await getSession())!;
  const profile = s.profile!;
  const mode = profile.age_mode as AgeMode;
  const db = await createClient();
  const goals = await getGoals(profile.id);
  const nearest = nearestActiveGoal(goals);
  const breakMode = (await effective<boolean>(db, profile.id, "break_mode")).value;
  if (!breakMode) await ensureDailySuggestions(db, profile);
  const today = todayIn(profile.timezone);
  const [missions, templates] = await Promise.all([listMissions(profile.id, { statuses: [...OPEN_STATUSES] }), loadActiveTemplates(db)]);
  const gameView = await getGameView(db, { id: profile.id, age_mode: mode, incentive_stage: profile.incentive_stage, avatar_stage_max: profile.avatar_stage_max ?? 1 });
  const byId = new Map(templates.map((x) => [x.id, x]));
  const todays = missions.filter((m) => !m.dismissed && (m.suggested_for === today || m.status !== "suggested"));
  // 5.5 العودة بعد انقطاع ≥ N أيام: ترحيب بلا لوم + سؤال واحد (يُجاب في محادثة بوضع comeback)
  const { data: lastTr } = await db.from("mission_transitions").select("at").in("mission_id", missions.map((m) => m.id)).order("at", { ascending: false }).limit(1);
  const lastAt = (lastTr ?? [])[0]?.at as string | undefined;
  const gapDays = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 86400000 : 0;
  const comeback = gapDays >= game.comeback.min_gap_days;
  // LIFE-1: دعوات التعميم المستحقة (إشعار مجدول حان وقته ولم يُرسل تقرير بعد)
  const { data: invites } = await db.from("notifications").select("id, payload").eq("profile_id", profile.id).eq("type", "transfer_invite").lte("scheduled_for", new Date().toISOString()).is("read_at", null).limit(3);
  const inviteMissionIds = ((invites ?? []) as Array<{ payload: { mission_id: string } }>).map((i) => i.payload.mission_id);
  const { data: reported } = inviteMissionIds.length ? await db.from("transfer_reports").select("mission_id").in("mission_id", inviteMissionIds) : { data: [] };
  const reportedIds = new Set(((reported ?? []) as Array<{ mission_id: string }>).map((r) => r.mission_id));
  const dueInvites = inviteMissionIds.filter((id) => !reportedIds.has(id));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("goals.nearest")}</CardTitle>
          {nearest ? <CardDescription className="text-base text-foreground">{nearest.title}{nearest.why ? ` — ${nearest.why}` : ""}</CardDescription> : <CardDescription>{t("goals.no_goals")}</CardDescription>}
        </CardHeader>
        {!nearest && <CardContent><Button asChild><Link href="/app/goals/new">{t("goals.first_goal_cta")}</Link></Button></CardContent>}
      </Card>

      {comeback && (
        <Card><CardHeader><CardTitle className="text-base">{t("home.comeback_title")}</CardTitle><CardDescription>{messagesContent.comeback_intro[mode]} {messagesContent.comeback_question[mode]}</CardDescription></CardHeader>
          <CardContent><Button asChild size="sm" variant="outline"><Link href="/app/chat?mode=comeback">{t("nav.chat")}</Link></Button></CardContent></Card>
      )}
      {dueInvites.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">{realMissions.transfer.invite}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">{dueInvites.map((id) => <Button key={id} asChild size="sm" variant="outline"><Link href={`/app/missions/${id}`}>{realMissions.transfer.title}</Link></Button>)}</CardContent></Card>
      )}
      <div className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{t("missions.today")}</h2><Button asChild size="sm" variant="ghost"><Link href="/app/missions/new">{t("nav.new_mission")}</Link></Button></div>
        {breakMode && <Alert>{t("missions.break_mode_on")}</Alert>}
        {!breakMode && todays.length === 0 && <Alert>{t("missions.none_today")}</Alert>}
        {todays.map((m) => {
          const tpl = byId.get(m.template_id);
          return (
            <Card key={m.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{textByMode(tpl?.title, mode) || m.template_id}</CardTitle>
                  <div className="flex gap-1"><Badge variant="secondary">{tpl ? t(`missions.level.${tpl.training_level}`) : ""}</Badge><Badge variant="muted">{t(`missions.status.${m.status}`)}</Badge>{m.needs_approval && <Badge variant="warning">{realMissions.needs_approval_notice}</Badge>}{m.source === "guardian" || m.source === "guardian_recurring" ? <Badge variant="outline">من المربي</Badge> : null}</div>
                </div>
                {tpl && <CardDescription>{fillVariables(textByMode(tpl.situation, mode), m.variables)}</CardDescription>}
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-2">
                <GoalChain goals={goals} goalId={m.goal_id} />
                <Button asChild size="sm"><Link href={`/app/missions/${m.id}`}>{m.status === "suggested" ? t("missions.choose") : t("common.continue")}</Link></Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <SpacePanel view={gameView} compact />
      <p className="text-xs text-muted-foreground">{explainers.ai_disclosure[mode]}</p>
    </div>
  );
}
