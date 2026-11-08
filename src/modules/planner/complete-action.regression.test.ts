/**
 * اختبار انحدار — ثغرة الخطوة 4: إنجاز مهمة من قائمة المخطط (P24، completeTaskAction) لم يكن يمنح XP التقدير/الكتلة
 * ولا أدلة P1/P3، لأن الفعل لم يستدعِ afterTaskCompleted (كان ذلك في مسار «تمّت؟» فقط).
 * يفشل هذا الاختبار لو أزيل الاستدعاء من الفعل أو مُرّرت له مهمة غير المنجزة أو ملف غير صاحبها.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PROFILE = { id: "00000000-0000-4000-8000-0000000000a1", kind: "player", age_mode: "teen", timezone: "Asia/Amman" };
const TASK_ID = "00000000-0000-4000-8000-0000000000b1";
const DONE_TASK = { id: TASK_ID, profile_id: PROFILE.id, status: "done", estimate_min: 30, actual_min: 30, postpone_count: 0, auto_rescheduled: false, completed_at: "2026-11-07T07:00:00Z" };
const ADMIN = { tag: "admin-client" };

const afterTaskCompleted = vi.fn(async () => ({ xp: 3, evidence: ["P1"] }));
const completeTask = vi.fn(async () => ({ ok: true as const, data: { nextTaskId: null, task: DONE_TASK } }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/modules/accounts", () => ({ getSession: async () => ({ userId: "u1", profile: PROFILE }) }));
vi.mock("@/shared/db/server", () => ({ createClient: async () => ({ tag: "user-client" }) }));
vi.mock("@/shared/db/admin", () => ({ createAdminClient: () => ADMIN }));
vi.mock("@/modules/settings", () => ({ effective: async () => ({ value: "sat" }) }));
vi.mock("@/modules/missions/queries", () => ({ todayIn: () => "2026-11-07" }));
vi.mock("./context", () => ({ loadPlannerContext: vi.fn() }));
vi.mock("./bridge-service", () => ({ afterTaskCompleted, afterTaskCancelled: vi.fn(async () => false) }));
vi.mock("./service", () => ({ completeTask }));

describe("انحدار: إنجاز مهمة من قائمة المخطط يمر بمسار XP والأدلة", () => {
  beforeEach(() => { afterTaskCompleted.mockClear(); completeTask.mockClear(); });

  it("completeTaskAction يستدعي afterTaskCompleted مرة واحدة بعميل الخدمة والملف والمهمة المنجزة، ويعيد XP", async () => {
    const { completeTaskAction } = await import("./actions");
    const fd = new FormData(); fd.set("task_id", TASK_ID); fd.set("actual_min", "30");
    const r = await completeTaskAction(null, fd);
    expect(r).toEqual({ ok: true, data: { nextTaskId: null, xp: 3 } });
    expect(completeTask).toHaveBeenCalledTimes(1);
    expect(afterTaskCompleted).toHaveBeenCalledTimes(1);
    expect(afterTaskCompleted).toHaveBeenCalledWith(ADMIN, PROFILE, DONE_TASK);
  });

  it("فشل الإنجاز ⇒ لا XP ولا أدلة", async () => {
    completeTask.mockResolvedValueOnce({ ok: false, error: "not_allowed" } as never);
    const { completeTaskAction } = await import("./actions");
    const fd = new FormData(); fd.set("task_id", TASK_ID);
    expect((await completeTaskAction(null, fd)).ok).toBe(false);
    expect(afterTaskCompleted).not.toHaveBeenCalled();
  });
});
