/** اختبارات ثابتة للمحادثة الحرة (AI-1..AI-15، 7.4) بقاعدة وهمية ومستدعٍ وهمي. */
import { describe, it, expect } from "vitest";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { fakeCaller } from "../runtime";
import { handlePlayerMessage, requestHuman, disclosureLine, type ChatContext } from "./service";
import { keywordSafety, mergeSafety } from "@/modules/safety/classify";
import { ai } from "@/shared/config";

const PROFILE = "00000000-0000-4000-8000-00000000000a";
const SESSION = "00000000-0000-4000-8000-00000000000b";
const ctx: ChatContext = { profileId: PROFILE, mode: "teen", support: "L1_hint", viewers: [{ name: "أبي", relation: "father" }], memory: { insights: [], lastSummary: null, personalContext: null } };

function setup(opts: { handoff?: "ai" | "guardian"; limitMinutes?: number | null; mode?: "child" | "teen" | "adult" } = {}) {
  const db = new FakeDb();
  db.seed("profiles", [{ id: PROFILE, age_mode: opts.mode ?? "teen", kind: "player", user_id: "u1" }]);
  db.seed("settings", opts.limitMinutes !== undefined ? [{ profile_id: PROFILE, key: "companion_free_chat_daily_minutes", value: opts.limitMinutes, set_by_role: "guardian", locked: false }] : []);
  db.seed("companion_sessions", [{ id: SESSION, profile_id: PROFILE, mode: "free", handoff: opts.handoff ?? "ai", handoff_guardian_id: null, handoff_at: null, turn_count: 0, ended_at: null }]);
  db.seed("guardian_links", [{ player_id: PROFILE, guardian_id: "g1", status: "active", permissions: { receive_alerts: true, intervene_chat: true, view_chat: true } }]);
  let notified = 0;
  db.rpcs.notify_safety = () => { notified++; db.seed("notifications", [{ profile_id: PROFILE, type: "safety_alert" }]); return 1; };
  const player = (text: string) => { db.seed("companion_messages", [{ session_id: SESSION, role: "player", content: text, author_id: "u1" }]); return db.rows("companion_messages").at(-1)!.id as string; };
  return { db, player, notifiedCount: () => notified };
}
const SAFE = JSON.stringify({ flag: false, category: null, severity: null });
// تسلسل الاستدعاءات لرد عادي: مصنّف وارد (light) → الرد (main) → مصنّف صادر (light) → التحليل (light)
const turn = (reply: string, a: string) => [SAFE, reply, SAFE, a];
const analysis = (o: Record<string, unknown> = {}) => JSON.stringify({ insights: [], needs_human: { flag: false, reason: null }, safety: { flag: false, category: null, severity: null }, context_suggestion: null, ...o });

describe("مصنّف الأمان بالكلمات (7.4)", () => {
  it("يكشف الأذى الذاتي مع التطبيع، ولا يعلّم النص العادي", () => {
    expect(keywordSafety("أحيانًا أفكر أن أقتل نفسي")).toMatchObject({ flag: true, category: "self_harm", severity: "high" });
    expect(keywordSafety("بابا بيضربني كل يوم")).toMatchObject({ flag: true, category: "abuse" });
    expect(keywordSafety("أريد أن أنهي واجبي قبل العشاء").flag).toBe(false);
    expect(mergeSafety({ flag: true, category: "abuse", severity: "medium" }, { flag: true, category: "self_harm", severity: "high" })).toMatchObject({ safety: { category: "self_harm" }, detector: "both" });
  });
});

describe("handlePlayerMessage", () => {
  it("رسالة واردة خطرة → رد آمن مكتوب مسبقًا، علم أمان، تنبيه فوري للمربي، لا استدعاء للمرافق (AI-5)", async () => {
    const s = setup();
    const caller = fakeCaller([SAFE]); // مصنّف النموذج يُستدعى؛ الكلمات تكفي للعلم
    const mid = s.player("ما بدي أعيش");
    const t0 = Date.now();
    const r = await handlePlayerMessage(s.db.client(), caller, ctx, SESSION, mid, "ما بدي أعيش");
    expect(r.kind).toBe("safety");
    expect(r.kind === "safety" && r.text).toContain("لست وحدك");
    expect(s.db.rows("safety_flags")).toHaveLength(1);
    expect(s.notifiedCount()).toBe(1);
    expect(Date.now() - t0).toBeLessThan(ai.safety.guardian_alert_max_seconds * 1000);
    expect(caller.calls.every((c) => c.model === "light")).toBe(true); // لا استدعاء للمرافق نفسه
    expect(s.db.rows("companion_messages").at(-1)).toMatchObject({ role: "ai", safety_flagged: true });
  });
  it("رد عادي: يُبث ويُحفظ، ويُحلَّل → مؤشرات بوزن منخفض كأدلة companion خارج المهام (AI-3)", async () => {
    const s = setup();
    const caller = fakeCaller(turn("ما الذي يجعل البداية صعبة؟", analysis({ insights: [{ capability_id: "self_awareness", type: "names_distraction", value: 0.4, confidence: 0.5 }] })));
    const chunks: string[] = [];
    const r = await handlePlayerMessage(s.db.client(), caller, ctx, SESSION, s.player("أؤجل دائمًا"), "أؤجل دائمًا", (t) => chunks.push(t));
    expect(r.kind).toBe("reply");
    expect(chunks.join("")).toContain("ما الذي يجعل البداية صعبة؟");
    expect(s.db.rows("companion_insights")).toHaveLength(1);
    const ev = s.db.rows("evidence_events")[0]!;
    expect(ev).toMatchObject({ source: "companion", type: "companion_insight", mission_id: null, capability_id: "self_awareness" });
    expect(Number(ev.weight)).toBeLessThan(0.3);
    const chatCall = caller.calls.find((c) => c.model === "main")!;
    expect(chatCall.system).not.toContain("JSON واحدًا"); // الرد نص لا JSON
    expect(chatCall.dynamicSystem).toContain("أبي (father)"); // من يرى المحادثة في السياق
  });
  it("AI-15: الرد بأكثر من سؤال يُقصّ إلى سؤال واحد ويُسجَّل replaced", async () => {
    const s = setup();
    const r = await handlePlayerMessage(s.db.client(), fakeCaller(turn("ماذا تريد؟ ولماذا؟ ومتى؟", analysis())), ctx, SESSION, s.player("x"), "x");
    expect(r.kind === "reply" && r.text).toBe("ماذا تريد؟");
    expect(s.db.rows("ai_calls").find((c) => c.function === "companion_chat")).toMatchObject({ valid: false });
  });
  it("needs_human من التحليل → طلب إنسان وإشعار المربين أصحاب intervene_chat ورد ثابت (AI-12)", async () => {
    const s = setup();
    const r = await handlePlayerMessage(s.db.client(), fakeCaller(turn("فهمت.", analysis({ needs_human: { flag: true, reason: "قرار عائلي" } }))), ctx, SESSION, s.player("هل أترك النادي؟"), "هل أترك النادي؟");
    expect(r.kind === "reply" && r.needsHuman).toBe(true);
    expect(s.db.rows("human_requests")).toHaveLength(1);
    expect(s.db.rows("notifications").filter((n) => n.type === "human_requested")).toHaveLength(1);
    expect(s.db.rows("companion_messages").at(-1)).toMatchObject({ role: "ai", needs_human: true });
  });
  it("handoff للمربي → المرافق لا يُستدعى (AI-11)", async () => {
    const s = setup({ handoff: "guardian" });
    const caller = fakeCaller([SAFE, "لن يُستدعى"]);
    const r = await handlePlayerMessage(s.db.client(), caller, ctx, SESSION, s.player("مرحبا"), "مرحبا");
    expect(r.kind).toBe("handoff");
    expect(caller.calls.filter((c) => c.model === "main")).toHaveLength(0);
  });
  it("حد الدقائق اليومي في child → رسالة هادئة (AI-9)؛ والمفتاح معطّل → اعتذار ثابت", async () => {
    const s = setup({ limitMinutes: 5, mode: "child" }); // 5 = الحد الأدنى في الكتالوج (القيم الأقل تُقص)
    for (let i = 1; i <= 5; i++) s.player(String(i));
    const r = await handlePlayerMessage(s.db.client(), fakeCaller([SAFE, "x"]), { ...ctx, mode: "child" }, SESSION, s.player("6"), "6");
    expect(r.kind).toBe("limit");
    const s2 = setup();
    const r2 = await handlePlayerMessage(s2.db.client(), fakeCaller([], { enabled: false }), ctx, SESSION, s2.player("x"), "x");
    expect(r2.kind).toBe("fallback");
    expect(r2.kind === "fallback" && r2.text).toContain("عذرًا");
  });
  it("زر «أريد أن أتحدث مع المربي» (AI-13) + سطر الإفصاح (AI-4)", async () => {
    const s = setup();
    const r = await requestHuman(s.db.client(), PROFILE, SESSION, null, "player", null);
    expect(r.notified).toBe(1);
    expect(disclosureLine(ctx.viewers)).toContain("أبي (father)");
    expect(disclosureLine([])).toContain("لا أحد غيرك");
  });
});
