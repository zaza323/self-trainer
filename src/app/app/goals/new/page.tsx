import { planner } from "@/shared/config";
import { getSession } from "@/modules/accounts";
import { GoalBuilder } from "@/modules/goals/components/goal-builder";
import fixedQuestions from "@content/fixed_questions.ar.json";
import type { AgeMode } from "@/shared/config";
import { aiEnabled } from "@/modules/companion";
import { goalDialogTurn, type GoalDialogState } from "@/modules/companion/actions";
import { GoalDialog } from "@/modules/companion/components/goal-dialog";
import messagesContent from "@content/companion_messages.ar.json";

export default async function NewGoalPage() {
  const s = (await getSession())!;
  const mode = s.profile!.age_mode as AgeMode;
  const q = fixedQuestions.goal_builder;
  if (aiEnabled()) {
    const first = await goalDialogTurn(null, new FormData());
    if (first.ok && first.data) return <GoalDialog voiceLang={planner.nlp.voice.lang} initial={first.data as GoalDialogState} intro={messagesContent.goal_builder_intro[mode]} namingMove={q.naming_move[mode]} />;
  }
  return <GoalBuilder questions={{ start: q.start[mode], why: q.why[mode], climb: q.climb[mode], stop_hint: q.stop_hint[mode], first_step: q.first_step[mode], naming_move: q.naming_move[mode] }} />;
}
