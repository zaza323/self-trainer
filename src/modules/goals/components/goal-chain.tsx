import { chainToRoot, type GoalNode } from "../tree";
import { t } from "@/shared/i18n";

/** GOAL-3: السلسلة مطوية (مهمة ← الغاية المباشرة ← … ← الجذر) مع فتح الحلقات الوسطى بلمسة. */
export function GoalChain({ goals, goalId }: { goals: GoalNode[]; goalId: string | null }) {
  if (!goalId) return <p className="text-sm text-muted-foreground">{t("missions.serves_goal")}: —</p>;
  const chain = chainToRoot(goals, goalId);
  if (chain.length === 0) return null;
  const first = chain[0]!, root = chain[chain.length - 1]!;
  const middle = chain.slice(1, -1);
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{t("missions.serves_goal")}: </span>
      <span className="font-medium">{first.title}</span>
      {chain.length > 1 && (
        <>
          {middle.length > 0 ? (
            <details className="inline"><summary className="inline cursor-pointer text-primary"> ← … ← </summary><span>{middle.map((g) => g.title).join(" ← ")} ← </span></details>
          ) : <span> ← </span>}
          <span className="font-medium">{root.title}</span>
        </>
      )}
    </div>
  );
}
