"use client";
import { useActionState, useState } from "react";
import { createReward, transitionReward, createCustomAchievement, type RewardActionResult } from "../actions";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { t } from "@/shared/i18n";
import rewardsContent from "@content/rewards.ar.json";
import capabilities from "@content/capabilities.ar.json";
import { customization, CAPABILITY_IDS } from "@/shared/config";

export type RewardRow = { id: string; title: string; description: string | null; icon: string; trigger_type: string; trigger_params: Record<string, unknown>; status: string; created_by: string; earned_at: string | null };
export type AchievementOption = { code: string; name: string };
export type GoalOption = { id: string; title: string };

const capName = (id: string) => (capabilities as unknown as Record<string, { name: string }>)[id]?.name ?? id;
const TRIGGERS = Object.keys(customization.real_rewards.allowed_triggers);

/** 5.7: نص العهد المعلن للمتدرب. */
export function pledgeText(r: RewardRow, creatorName: string, achievements: AchievementOption[], goals: GoalOption[]): string {
  const tpl = (rewardsContent.triggers as Record<string, { pledge: string }>)[r.trigger_type]?.pledge ?? r.title;
  const p = r.trigger_params;
  const pledge = tpl
    .replace("{title}", r.title)
    .replace("{capability}", capName(String(p.capability_id ?? "")))
    .replace("{count}", String(p.count ?? "")).replace("{contexts}", String(p.min_distinct_contexts ?? 1))
    .replace("{level}", (rewardsContent.levels as Record<string, string>)[String(p.level ?? "")] ?? String(p.level ?? ""))
    .replace("{achievement}", achievements.find((a) => a.code === p.achievement_code)?.name ?? String(p.achievement_code ?? ""))
    .replace("{goal}", goals.find((g) => g.id === p.goal_id)?.title ?? "");
  return rewardsContent.pledge_from.replace("{creator}", creatorName).replace("{pledge}", pledge);
}

function TriggerFields({ type, achievements, goals }: { type: string; achievements: AchievementOption[]; goals: GoalOption[] }) {
  const spec = (customization.real_rewards.allowed_triggers[type]?.params ?? {}) as Record<string, unknown>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {"capability_id" in spec && <div className="space-y-1"><Label htmlFor="param_capability_id">القدرة</Label><Select id="param_capability_id" name="param_capability_id" defaultValue="attention">{CAPABILITY_IDS.map((c) => <option key={c} value={c}>{capName(c)}</option>)}</Select></div>}
      {"count" in spec && <div className="space-y-1"><Label htmlFor="param_count">العدد</Label><Input id="param_count" name="param_count" type="number" dir="ltr" min={(spec.count as { min: number }).min} max={(spec.count as { max: number }).max} defaultValue={(spec.count as { min: number }).min} required /></div>}
      {"min_distinct_contexts" in spec && <div className="space-y-1"><Label htmlFor="param_min_distinct_contexts">سياقات مختلفة</Label><Input id="param_min_distinct_contexts" name="param_min_distinct_contexts" type="number" dir="ltr" min={(spec.min_distinct_contexts as { min: number }).min} max={(spec.min_distinct_contexts as { max: number }).max} defaultValue={(spec.min_distinct_contexts as { min: number }).min} /></div>}
      {"level" in spec && <div className="space-y-1"><Label htmlFor="param_level">المستوى</Label><Select id="param_level" name="param_level" defaultValue={(spec.level as string[])[0]}>{(spec.level as string[]).map((l) => <option key={l} value={l}>{(rewardsContent.levels as Record<string, string>)[l] ?? l}</option>)}</Select></div>}
      {"achievement_code" in spec && <div className="space-y-1"><Label htmlFor="param_achievement_code">الإنجاز</Label><Select id="param_achievement_code" name="param_achievement_code">{achievements.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</Select></div>}
      {"goal_id" in spec && <div className="space-y-1"><Label htmlFor="param_goal_id">الغاية</Label><Select id="param_goal_id" name="param_goal_id">{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</Select></div>}
    </div>
  );
}

function Err({ s }: { s: RewardActionResult | null }) {
  if (!s || s.ok) return null;
  const msg = s.error === "forbidden" ? `${rewardsContent.forbidden_explained}` : s.error === "max_active" ? `حد العهود النشطة ${customization.real_rewards.max_active_per_player}` : s.explanation ?? `${t("common.error_generic")} (${s.error})`;
  return <Alert variant="error" className="text-sm">{msg}</Alert>;
}

/** G05/G06: إنشاء المكافآت والإنجازات الخاصة وتسليمها (REWARD-1..7، GAME-10). */
export function GuardianRewardsPanel({ profileId, rewards, achievements, goals, stage, creatorName }: { profileId: string; rewards: RewardRow[]; achievements: AchievementOption[]; goals: GoalOption[]; stage: number; creatorName: string }) {
  const [type, setType] = useState("gate2_shown_count");
  const [aType, setAType] = useState("gate2_shown_count");
  const [cs, createAct, creating] = useActionState(createReward, null);
  const [ts, transAct, transitioning] = useActionState(transitionReward, null);
  const [as, achAct, creatingAch] = useActionState(createCustomAchievement, null);
  const triggersNoSurprise = TRIGGERS.filter((x) => !customization.custom_achievements.exclude_triggers.includes(x));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">{t("guardian.rewards")}</CardTitle><CardDescription>{rewardsContent.creation_hint}</CardDescription></CardHeader>
        <CardContent>
          {stage >= customization.real_rewards.stage_guidance_from_stage && <Alert className="mb-3 text-sm">{rewardsContent.stage_guidance}</Alert>}
          <form action={createAct} className="space-y-3">
            <input type="hidden" name="profile_id" value={profileId} />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="title">العنوان</Label><Input id="title" name="title" required maxLength={120} /></div>
              <div className="space-y-1"><Label htmlFor="icon">أيقونة</Label><Input id="icon" name="icon" maxLength={8} defaultValue="🎁" /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="description">وصف قصير</Label><Input id="description" name="description" maxLength={500} /></div>
            <div className="space-y-1"><Label htmlFor="trigger_type">المحفز</Label>
              <Select id="trigger_type" name="trigger_type" value={type} onChange={(e) => setType(e.target.value)}>{TRIGGERS.map((k) => <option key={k} value={k}>{(rewardsContent.triggers as Record<string, { label: string }>)[k]?.label ?? k}</option>)}</Select></div>
            <TriggerFields type={type} achievements={achievements} goals={goals} />
            {type !== "surprise" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="activate" defaultChecked /> إعلان العهد للمتدرب الآن (active)</label>}
            <Err s={cs} />
            <Button type="submit" disabled={creating}>{type === "surprise" ? "منح المفاجأة" : "إنشاء"}</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">العهود</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rewards.length === 0 && <p className="text-sm text-muted-foreground">لا مكافآت بعد.</p>}
          {rewards.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
              <div><span className="me-1">{r.icon}</span><strong>{r.title}</strong> <Badge variant={r.status === "earned" ? "success" : r.status === "active" ? "secondary" : "muted"}>{(rewardsContent.status as Record<string, string>)[r.status]}</Badge><div className="text-xs text-muted-foreground">{pledgeText(r, creatorName, achievements, goals)}</div></div>
              <form action={transAct} className="flex gap-1">
                <input type="hidden" name="reward_id" value={r.id} />
                {r.status === "draft" && <Button type="submit" name="to" value="active" size="sm" disabled={transitioning}>إعلان</Button>}
                {r.status === "earned" && <Button type="submit" name="to" value="delivered" size="sm" disabled={transitioning}>سلّمتها</Button>}
                {(r.status === "draft" || r.status === "active") && <Button type="submit" name="to" value="cancelled" size="sm" variant="ghost" disabled={transitioning}>إلغاء</Button>}
              </form>
            </div>
          ))}
          <Err s={ts} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">إنجاز خاص (GAME-10)</CardTitle><CardDescription>يظهر كشارة حسب كثافة اللعبة. المحفزات نفسها بلا مفاجأة.</CardDescription></CardHeader>
        <CardContent>
          <form action={achAct} className="space-y-3">
            <input type="hidden" name="profile_id" value={profileId} />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="name">الاسم</Label><Input id="name" name="name" required maxLength={80} /></div>
              <div className="space-y-1"><Label htmlFor="aicon">أيقونة</Label><Input id="aicon" name="icon" maxLength={8} defaultValue="★" /></div>
            </div>
            <div className="space-y-1"><Label htmlFor="atrigger">المحفز</Label><Select id="atrigger" name="trigger_type" value={aType} onChange={(e) => setAType(e.target.value)}>{triggersNoSurprise.map((k) => <option key={k} value={k}>{(rewardsContent.triggers as Record<string, { label: string }>)[k]?.label ?? k}</option>)}</Select></div>
            <TriggerFields type={aType} achievements={achievements} goals={goals} />
            <Err s={as} />
            <Button type="submit" variant="outline" disabled={creatingAch}>إنشاء الإنجاز</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** P15 عهودي (REWARD-5): تظهر مهما كانت كثافة اللعبة. المتدرب يؤكد الاستلام. */
export function PledgesPanel({ rewards, achievements, goals, creatorNames, selfCreate }: { rewards: RewardRow[]; achievements: AchievementOption[]; goals: GoalOption[]; creatorNames: Record<string, string>; selfCreate?: React.ReactNode }) {
  const [ts, transAct, pending] = useActionState(transitionReward, null);
  const visible = rewards.filter((r) => r.status !== "draft");
  return (
    <div className="space-y-3">
      {visible.length === 0 && <Alert>{rewardsContent.no_pledges}</Alert>}
      {visible.map((r) => (
        <Card key={r.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <div><span className="me-1 text-xl">{r.icon}</span><strong>{r.title}</strong> <Badge variant={r.status === "earned" ? "success" : r.status === "active" ? "secondary" : "muted"}>{(rewardsContent.status as Record<string, string>)[r.status]}</Badge><div className="text-xs text-muted-foreground">{pledgeText(r, creatorNames[r.created_by] ?? "مربّيك", achievements, goals)}</div>{r.status === "cancelled" && <div className="text-xs">{rewardsContent.cancelled_notice.replace("{title}", r.title)}</div>}</div>
          {r.status === "delivered" && <form action={transAct}><input type="hidden" name="reward_id" value={r.id} /><Button type="submit" name="to" value="acknowledged" size="sm" disabled={pending}>استلمتها</Button></form>}
        </CardContent></Card>
      ))}
      <Err s={ts} />
      {selfCreate}
    </div>
  );
}
