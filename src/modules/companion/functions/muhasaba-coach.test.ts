/** ز.8-3 وهـ.11-4: «أنا فاشل» ⇒ رد لا يؤكد الحكم (مخرج النموذج المؤكِّد يُرفض ويسقط إلى السلوك المحدد)؛ لا ممنوعات راحة في System Prompt. */
import { describe, it, expect } from "vitest";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { fakeCaller } from "../runtime";
import { muhasabaCoach, verifyMuhasabaReply } from "./muhasaba-coach";
import { personaSystem, FUNCTION_INSTRUCTIONS } from "../prompts";
import { restConfig } from "@/modules/rest/suggest";

const safe = { flag: false, category: null, severity: null };
const out = (o: Record<string, unknown>) => JSON.stringify({ next_question: "", done: false, reflection_summary_user_words: null, thinking_move_named: null, custom_strategy_fit: null, evidence_candidates: [], safety: safe, ...o });

describe("محاسبة النفس — جلد الذات", () => {
  it("مخرج يؤكد الحكم يُرفض مرتين ⇒ السقوط إلى رد يعيد الكلام للسلوك المحدد", async () => {
    const bad = out({ next_question: "نعم أنت فاشل فعلًا، لماذا؟" });
    const r = await muhasabaCoach({ db: new FakeDb().client(), caller: fakeCaller([bad, bad]), profileId: "p", mode: "teen", shortfallText: "المراجعة", reasonText: "أنا فاشل" });
    expect(r.source).toBe("fixed"); expect(r.selfBlame).toBe(true);
    expect(r.reply).toContain("المراجعة"); expect(r.reply).not.toMatch(/فاشل|كسول/);
    expect(verifyMuhasabaReply(JSON.parse(bad))).toBe("affirms_self_blame");
  });
  it("مخرج صالح يُقبل مع مرشح M1 على self_awareness فقط", async () => {
    const good = out({ next_question: "اليوم ما مشيت المراجعة. شو اللي صعّبها؟", evidence_candidates: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.5, rationale: "ربط السبب بالوقت" }] });
    const r = await muhasabaCoach({ db: new FakeDb().client(), caller: fakeCaller([good]), profileId: "p", mode: "teen", shortfallText: "المراجعة", reasonText: "ما كان في وقت لأني رجعت متأخر" });
    expect(r.source).toBe("ai"); expect(r.candidates).toHaveLength(1);
    expect(verifyMuhasabaReply({ ...JSON.parse(good), evidence_candidates: [{ capability_id: "planning", type: "reflection_quality", value: 0.5, rationale: "x" }] })).toBe("candidate_capability_not_allowed");
  });
});

describe("الراحة في المرافق (هـ.7)", () => {
  it("System Prompt يمنع اقتراح الألعاب والفيديو القصير والتصفح ويقصر الاقتراح على قائمة الراحة", () => {
    const sys = personaSystem("teen");
    expect(sys).toMatch(/الألعاب/); expect(sys).toMatch(/الفيديو القصير/); expect(sys).toMatch(/التصفح/); expect(sys).toMatch(/الراحة المجدِّدة/);
    for (const k of restConfig.never_suggest) expect(["games", "short_video", "social_feed", "browsing"]).toContain(k);
    expect(FUNCTION_INSTRUCTIONS.muhasaba_coach).toMatch(/سلوك لا هوية/);
  });
});
