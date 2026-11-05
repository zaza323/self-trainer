import { describe, it, expect } from "vitest";
import { planAgeTransition } from "./age-transition";
import { ALL_PERMISSIONS, VIEW_PROGRESS_ONLY } from "@/shared/config/permissions";

describe("planAgeTransition (القسم 13)", () => {
  it("child → teen: المربون يبقون، الأقفال تُرفع عدا إعدادات الأمان", () => {
    const plan = planAgeTransition({
      from: "child", to: "teen",
      links: [{ id: "l1", permissions: ALL_PERMISSIONS, status: "active" }],
      locks: [{ key: "space_theme", locked: true }, { key: "companion_free_chat_daily_minutes", locked: true }, { key: "break_mode", locked: false }],
    });
    expect(plan.allowedActor).toBe("creator_guardian");
    expect(plan.linkPermissionResets).toEqual([]);
    expect(plan.unlockKeys).toEqual(["space_theme"]);
    expect(plan.keptLockedKeys).toEqual(["companion_free_chat_daily_minutes"]);
  });

  it("teen → adult: كل صلاحيات المربين النشطين تعود إلى view_progress فقط", () => {
    const plan = planAgeTransition({
      from: "teen", to: "adult",
      links: [
        { id: "l1", permissions: ALL_PERMISSIONS, status: "active" },
        { id: "l2", permissions: ALL_PERMISSIONS, status: "removed" },
      ],
      locks: [],
    });
    expect(plan.allowedActor).toBe("player");
    expect(plan.linkPermissionResets).toEqual([{ id: "l1", permissions: VIEW_PROGRESS_ONLY }]);
  });

  it("لا انتقال إلى child", () => {
    expect(() => planAgeTransition({ from: "teen", to: "child", links: [], locks: [] })).toThrow("cannot_transition_into_child");
  });
});
