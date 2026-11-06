import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), redirect: () => {} }));
vi.mock("@/shared/db/client", () => ({ createClient: () => { throw new Error("no browser client in tests"); } }));
import { renderToString } from "react-dom/server";
import { ChatPanel } from "./chat-panel";
import { GoalDialog } from "./goal-dialog";
import { ReflectionDialog } from "./reflection-dialog";

const msgs = [
  { id: "1", role: "player" as const, content: "أؤجل دائمًا", needs_human: false, safety_flagged: false, meta: {}, created_at: "" },
  { id: "2", role: "ai" as const, content: "ما الذي يجعل البداية صعبة؟", needs_human: false, safety_flagged: false, meta: {}, created_at: "" },
  { id: "3", role: "system" as const, content: "handoff_guardian", needs_human: false, safety_flagged: false, meta: { name: "أبي" }, created_at: "" },
  { id: "4", role: "guardian" as const, content: "أنا هنا", needs_human: false, safety_flagged: false, meta: { name: "أبي" }, created_at: "" },
];

describe("شاشات المرافق", () => {
  it("P14: الإفصاح دائم، رسائل المربي باسمه، زر التحدث مع المربي (AI-4، AI-13، GUARD-8)", () => {
    const html = renderToString(<ChatPanel sessionId="00000000-0000-4000-8000-000000000001" messages={msgs} disclosure="المرافق ذكاء اصطناعي. يرى هذه المحادثة: أبي (أب)." viewer="player" handoff="guardian" handoffGuardianName="أبي" guardianNames={["أبي"]} />);
    expect(html).toContain("المرافق ذكاء اصطناعي");
    expect(html).toContain("أبي يشارك في المحادثة الآن");
    expect(html).toContain("أريد أن أتحدث مع أبي");
    expect(html).toContain("أنا هنا");
  });
  it("G03: زرا التدخل وإعادة الكلمة للمربي المخوّل فقط (GUARD-6)", () => {
    const a = renderToString(<ChatPanel sessionId="00000000-0000-4000-8000-000000000001" messages={msgs} disclosure="x" viewer="guardian" handoff="ai" canIntervene />);
    expect(a).toContain("تدخّل");
    const b = renderToString(<ChatPanel sessionId="00000000-0000-4000-8000-000000000001" messages={msgs} disclosure="x" viewer="guardian" handoff="guardian" canIntervene />);
    expect(b).toContain("أعد الكلمة للمرافق");
    expect(b).toContain('name="text"');
    const c = renderToString(<ChatPanel sessionId="00000000-0000-4000-8000-000000000001" messages={msgs} disclosure="x" viewer="guardian" handoff="ai" canIntervene={false} />);
    expect(c).not.toContain("تدخّل");
  });
  it("P02: المسودة الحية قابلة للتعديل بكلمات المستخدم (AI-16)", () => {
    const html = renderToString(<GoalDialog initial={{ sessionId: "s", turn: 1, source: "ai", history: [{ role: "assistant", content: "ولماذا هذا؟" }], output: { next_question: "ولماذا هذا؟", reflection_of_user_words: "x", thinking_move_named: "clarify_motive", phase: "climb_why", draft: { goals: [{ temp_id: "g1", parent_temp_id: null, title_user_words: "أنهي واجباتي قبل العشاء", why_user_words: null }], first_step_user_words: null }, needs_user_confirmation: false, safety: { flag: false, category: null, severity: null }, moment: "goal_why", response_mode: "free_text", options: [] } }} intro="لنبدأ" namingMove="حوّلت أمنية إلى خطوة." voiceLang="ar-JO" />);
    expect(html).toContain('value="أنهي واجباتي قبل العشاء"');
    expect(html).toContain("clarify_motive");
    expect(html).toContain("ولماذا هذا؟");
    expect(html).not.toContain("غير ذلك"); // goal_why: كتابة فقط، لا خيارات
  });
  it("0.4 أ: choices_plus_other يعرض الخيارات وزر «غير ذلك» الذي تضيفه الواجهة", () => {
    const html = renderToString(<ReflectionDialog missionId="00000000-0000-4000-8000-000000000009" gate1 voiceLang="ar-JO" initial={{ sessionId: "s", turn: 1, source: "ai", history: [{ role: "assistant", content: "ما الذي عطّلك؟" }], output: { next_question: "ما الذي عطّلك؟", done: false, reflection_summary_user_words: null, thinking_move_named: null, custom_strategy_fit: null, evidence_candidates: [], safety: { flag: false, category: null, severity: null }, moment: "reflection_secondary", response_mode: "choices_plus_other", options: [{ id: "o1", label: "تشتت", source: "template" }, { id: "o2", label: "تعب", source: "ai" }] } }} />);
    expect(html).toContain("تشتت");
    expect(html).toContain("غير ذلك");
    expect(html).not.toContain("<textarea"); // الحقل يظهر بعد الضغط على «غير ذلك»
  });
  it("P09: حوار التأمل يعرض السؤال الواحد وزر المتابعة", () => {
    const html = renderToString(<ReflectionDialog missionId="00000000-0000-4000-8000-000000000009" gate1 voiceLang="ar-JO" initial={{ sessionId: "s", turn: 1, source: "ai", history: [{ role: "assistant", content: "ما الذي ساعدك؟" }], output: { next_question: "ما الذي ساعدك؟", done: false, reflection_summary_user_words: null, thinking_move_named: null, custom_strategy_fit: null, evidence_candidates: [], safety: { flag: false, category: null, severity: null }, moment: "reflection_core", response_mode: "free_text", options: [] } }} />);
    expect(html).toContain("ما الذي ساعدك؟");
    expect(html).toContain("<textarea");
  });
});
