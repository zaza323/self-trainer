import { describe, it, expect } from "vitest";
import { normalizePermissions, VIEW_PROGRESS_ONLY, ALL_PERMISSIONS, GUARDIAN_PERMISSIONS } from "./permissions";
import { customization } from "./index";

describe("permissions (ACC-8, ACC-10)", () => {
  it("عشر صلاحيات بالترتيب الثابت، تطابق config (ب.12)", () => {
    expect([...GUARDIAN_PERMISSIONS]).toEqual(customization.permissions_all);
    expect(GUARDIAN_PERMISSIONS[0]).toBe("view_progress");
    expect(GUARDIAN_PERMISSIONS).toContain("view_planner");
  });
  it("normalize يتجاهل المفاتيح الغريبة ويعتبر غير true كـ false", () => {
    expect(normalizePermissions({ view_chat: true, hack: true, add_rewards: "yes" })).toEqual({ ...VIEW_PROGRESS_ONLY, view_progress: false, view_chat: true });
    expect(normalizePermissions(null)).toEqual(Object.fromEntries(GUARDIAN_PERMISSIONS.map((p) => [p, false])));
  });
  it("افتراضي مربي البالغ = view_progress فقط", () => {
    expect(Object.values(VIEW_PROGRESS_ONLY).filter(Boolean)).toHaveLength(1);
    expect(Object.values(ALL_PERMISSIONS).every(Boolean)).toBe(true);
  });
});
