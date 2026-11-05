import { describe, it, expect } from "vitest";
import { canTransition, nextStatuses, ALLOWED_TRANSITIONS, MISSION_STATUSES } from "./state-machine";

describe("آلة حالات المهمة (4.5)", () => {
  it("المسار السعيد كاملًا", () => {
    const path = ["suggested", "chosen", "planned", "in_progress", "completed", "reflected", "transferred"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it("الانقطاع والعودة، والتخلي يدخل التأمل", () => {
    expect(canTransition("in_progress", "interrupted")).toBe(true);
    expect(canTransition("interrupted", "in_progress")).toBe(true);
    expect(canTransition("interrupted", "abandoned")).toBe(true);
    expect(canTransition("abandoned", "reflected")).toBe(true);
  });
  it("لا قفز ولا رجوع", () => {
    expect(canTransition("suggested", "in_progress")).toBe(false);
    expect(canTransition("completed", "in_progress")).toBe(false);
    expect(canTransition("reflected", "completed")).toBe(false);
    expect(canTransition("interrupted", "completed")).toBe(false);
    expect(nextStatuses("transferred")).toEqual([]);
  });
  it("11 انتقالًا بالضبط كما في المواصفات، وكل حالة مذكورة", () => {
    expect(ALLOWED_TRANSITIONS).toHaveLength(11);
    const mentioned = new Set(ALLOWED_TRANSITIONS.flat());
    for (const s of MISSION_STATUSES) expect(mentioned.has(s)).toBe(true);
  });
});
