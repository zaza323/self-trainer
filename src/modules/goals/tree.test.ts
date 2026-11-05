import { describe, it, expect } from "vitest";
import { chainToRoot, buildForest, nearestActiveGoal, wouldCycle, depthOf } from "./tree";

const g = (id: string, parent: string | null, created = "2026-01-01", status: "active" | "completed" | "archived" = "active") => ({ id, parent_goal_id: parent, title: id, why: null, status, created_at: created });

describe("شجرة الغايات", () => {
  const goals = [g("root", null), g("mid", "root"), g("leaf", "mid", "2026-01-02"), g("leaf2", "root", "2026-01-03")];
  it("السلسلة من الورقة إلى الجذر (GOAL-3)", () => {
    expect(chainToRoot(goals, "leaf").map((x) => x.id)).toEqual(["leaf", "mid", "root"]);
    expect(depthOf(goals, "leaf")).toBe(3);
  });
  it("الغابة والأبناء", () => {
    const f = buildForest(goals);
    expect(f).toHaveLength(1);
    expect(f[0]!.children.map((c) => c.node.id)).toEqual(["mid", "leaf2"]);
  });
  it("الغاية القريبة = أحدث ورقة نشطة", () => {
    expect(nearestActiveGoal(goals)!.id).toBe("leaf2");
    expect(nearestActiveGoal([g("a", null, "2026-01-01", "completed")])).toBeNull();
  });
  it("كشف الدورة عند النقل", () => {
    expect(wouldCycle(goals, "root", "leaf")).toBe(true);
    expect(wouldCycle(goals, "leaf", "leaf2")).toBe(false);
    expect(wouldCycle(goals, "mid", "mid")).toBe(true);
  });
});
