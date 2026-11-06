import { planner } from "@/shared/config";
import { notFound } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { getGoals } from "@/modules/goals";
import { GoalChain } from "@/modules/goals/components/goal-chain";
import { getMission, buildNarrative, alternatives } from "@/modules/missions";
import { reflectionPromptsFor } from "@/modules/missions/actions";
import { MissionFlow } from "@/modules/missions/components/mission-flow";
import { limits, type AgeMode } from "@/shared/config";
import fixedQuestions from "@content/fixed_questions.ar.json";
import spaceContent from "@content/space.ar.json";
import surprisesContent from "@content/surprises.ar.json";
import { getGameView } from "@/modules/game";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { aiEnabled, anthropicCaller, narrate } from "@/modules/companion";
import { reflectionDialogTurn, type ReflectionDialogState } from "@/modules/companion/actions";
import { ReflectionDialog } from "@/modules/companion/components/reflection-dialog";
import { TransferForm } from "@/modules/life/components/life-forms";
import { primaryCapability } from "@/modules/library";
import { showMemoryInPlanning, bestStrategy } from "@/modules/adaptation";
import { loadStrategyOutcomes } from "@/modules/adaptation/service";

/** P07/P08/P09/P10 بحسب حالة المهمة. */
export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = (await getSession())!;
  const found = await getMission(id);
  if (!found || found.mission.profile_id !== s.profile!.id) notFound();
  const { mission, template, reflection } = found;
  const mode = s.profile!.age_mode as AgeMode;
  const goals = await getGoals(s.profile!.id);
  const activeGoals = goals.filter((g) => g.status === "active").map((g) => ({ id: g.id, title: g.title }));
  // 4.13.2 (ADAPT-3): عند L0–L1 وسم "نجحت معك سابقًا" على الاستراتيجية الأنجح
  let workedBefore: string | null = null;
  if (mission.status === "chosen" && showMemoryInPlanning(mission.support_level)) {
    const rows = await loadStrategyOutcomes(await createClient(), s.profile!.id);
    workedBefore = bestStrategy(rows, template.mechanic)?.strategy_key ?? null;
  }
  const needPrompts = mission.status === "completed" || mission.status === "abandoned";
  // دون اتصال: الأسئلة تُحمَّل مسبقًا مع صفحة التنفيذ (المرحلة 6)
  const ahead = mission.status === "in_progress" || mission.status === "interrupted" || mission.status === "planned";
  const prompts = needPrompts || ahead ? await reflectionPromptsFor(id) : [];
  const promptsAbandon = ahead ? await reflectionPromptsFor(id, "abandoned") : undefined;
  let narrative = mission.status === "reflected" || mission.status === "transferred"
    ? buildNarrative({ status: mission.status, gate1: mission.gate1, strategy_chosen: mission.strategy_chosen, custom_strategy: mission.custom_strategy, prediction: mission.prediction, actual_duration_min: mission.actual_duration_min, hints_used: mission.hints_used, distraction_log: mission.distraction_log, interrupted: mission.interruption_reasons.length > 0 || false }, template, mode)
    : [];
  // progress_narrator (7.2): يُحسب مرة ويُحفظ في reflections.summary؛ السقوط الجمل الثابتة
  if (narrative.length && aiEnabled() && reflection) {
    if (reflection.summary && reflection.summary.startsWith("narrative:")) narrative = reflection.summary.slice("narrative:".length).split("\n").filter(Boolean);
    else {
      try {
        const admin = createAdminClient();
        const n = await narrate({ db: admin, caller: anthropicCaller(), profileId: s.profile!.id, mode, facts: { gate1: mission.gate1, gate2: mission.gate2, strategy: mission.strategy_chosen, custom_strategy: mission.custom_strategy, prediction: mission.prediction, actual: mission.actual_duration_min, hints: mission.hints_used, distractions: mission.distraction_log.map((d) => d.choice), interrupted: mission.interruption_reasons.length > 0, answers: reflection.prompts_and_answers }, fixedLines: narrative });
        if (n.source === "ai") { narrative = n.lines; await admin.from("reflections").update({ summary: "narrative:" + n.lines.join("\n") }).eq("id", reflection.id); }
      } catch { /* بلا مفتاح خدمة */ }
    }
  }
  let reflectionDialog: ReflectionDialogState | null = null;
  if (needPrompts && aiEnabled()) {
    const fd = new FormData(); fd.set("mission_id", id);
    const r = await reflectionDialogTurn(null, fd);
    if (r.ok && r.data) reflectionDialog = r.data as ReflectionDialogState;
  }
  let celebration: { level: "none" | "subtle" | "full"; messages: string[] } = { level: "none", messages: [] };
  if (mission.status === "reflected" || mission.status === "transferred") {
    const db = await createClient();
    const gv = await getGameView(db, { id: s.profile!.id, age_mode: mode, incentive_stage: s.profile!.incentive_stage, avatar_stage_max: s.profile!.avatar_stage_max ?? 1 });
    const level = gv.visible.has("celebration_full") ? "full" : gv.visible.has("celebration_subtle") ? "subtle" : "none";
    const msgs: string[] = [];
    if (mission.gate2 === "shown") msgs.push(spaceContent.celebration[level === "full" ? "full" : "subtle"].shown);
    for (const a of gv.achievements.filter((x) => x.source_id === mission.id)) msgs.push(`${spaceContent.celebration[level === "full" ? "full" : "subtle"].achievement} ${a.name}`);
    // تعديل 0.3 §3: المفاجأة (إن وُجدت) تُعرض مع الاحتفال؛ رسالة التشجيع تُعرض حتى عند كثافة منخفضة لأنها نص لا عنصر لعبي
    const { data: sp } = await db.from("surprise_events").select("kind, payload").eq("mission_id", mission.id).maybeSingle();
    if (sp) {
      const x = sp as { kind: string; payload: { icon?: string; xp?: number; text?: string } };
      const line = x.kind === "cosmetic" ? `${surprisesContent.title} ${surprisesContent.kinds.cosmetic} ${x.payload.icon ?? ""}` : x.kind === "xp_bonus" ? `${surprisesContent.title} ${surprisesContent.xp_bonus_text.replace("{n}", String(x.payload.xp ?? 0))}` : `${surprisesContent.title} ${x.payload.text ?? ""}`;
      if (x.kind === "encouragement" || level !== "none") msgs.push(line);
    }
    celebration = { level, messages: msgs };
  }
  return (
    <MissionFlow
      mission={mission} template={template} mode={mode} reflection={reflection} reflectionPrompts={prompts}
      interruptionQuestion={fixedQuestions.interruption_question[mode]}
      narrative={narrative} alternatives={mission.status === "reflected" || mission.status === "transferred" ? alternatives(template, mission.strategy_chosen, mode) : []}
      distraction={{ firstAtFraction: limits.distraction.first_at_fraction, spreadFraction: limits.distraction.spread_fraction }}
      goalOptions={activeGoals}
      chain={<GoalChain goals={goals} goalId={mission.goal_id} />}
      celebration={celebration}
      reflectionOverride={reflectionDialog ? <ReflectionDialog voiceLang={planner.nlp.voice.lang} missionId={id} initial={reflectionDialog} gate1={Boolean(mission.gate1)} /> : undefined}
      after={mission.status === "reflected" && template.training_level !== "simulated" ? <TransferForm missionId={id} capabilityId={primaryCapability(template)} /> : undefined}
      reflectionPromptsAbandon={promptsAbandon}
      workedBefore={workedBefore}
    />
  );
}
