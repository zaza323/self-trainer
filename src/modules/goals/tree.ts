/** دوال نقية لشجرة الغايات (4.2، GOAL-3). */
export type GoalNode = {
  id: string;
  parent_goal_id: string | null;
  title: string;
  why: string | null;
  status: "active" | "completed" | "archived";
  created_at?: string;
};

/** السلسلة من الغاية إلى الجذر: [الغاية، أبوها، …، الجذر]. */
export function chainToRoot<T extends GoalNode>(goals: T[], goalId: string): T[] {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const out: T[] = [];
  const seen = new Set<string>();
  let cur = byId.get(goalId);
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    cur = cur.parent_goal_id ? byId.get(cur.parent_goal_id) : undefined;
  }
  return out;
}

export function depthOf<T extends GoalNode>(goals: T[], goalId: string): number {
  return chainToRoot(goals, goalId).length;
}

export type GoalTree<T extends GoalNode> = { node: T; children: GoalTree<T>[] };

export function buildForest<T extends GoalNode>(goals: T[]): GoalTree<T>[] {
  const byParent = new Map<string | null, T[]>();
  for (const g of goals) {
    const k = g.parent_goal_id && goals.some((x) => x.id === g.parent_goal_id) ? g.parent_goal_id : null;
    byParent.set(k, [...(byParent.get(k) ?? []), g]);
  }
  const build = (parent: string | null): GoalTree<T>[] =>
    (byParent.get(parent) ?? []).sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")).map((node) => ({ node, children: build(node.id) }));
  return build(null);
}

/** الغاية "القريبة" الحالية: ورقة نشطة أحدث إنشاءً (5.2). */
export function nearestActiveGoal<T extends GoalNode>(goals: T[]): T | null {
  const active = goals.filter((g) => g.status === "active");
  const hasChild = new Set(active.filter((g) => g.parent_goal_id).map((g) => g.parent_goal_id!));
  const leaves = active.filter((g) => !hasChild.has(g.id));
  return leaves.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null;
}

/** هل نقل الغاية إلى أب جديد يسبب دورة؟ (مرآة لفحص الخادم) */
export function wouldCycle<T extends GoalNode>(goals: T[], goalId: string, newParentId: string | null): boolean {
  if (!newParentId) return false;
  if (newParentId === goalId) return true;
  return chainToRoot(goals, newParentId).some((g) => g.id === goalId);
}
