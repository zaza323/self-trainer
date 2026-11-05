/** اختبارات ثابتة لـ adaptation_advisor و template_drafter (7.2) بمستدعٍ وهمي. */
import { describe, it, expect } from "vitest";
import { FakeDb } from "@tests/stubs/fake-supabase";
import { fakeCaller } from "../runtime";
import { adviseAdaptation, draftTemplate, verifyDraft } from "./adaptation-advisor-drafter";
import { loadTemplatesFromContent } from "@/modules/library/content";

const templates = loadTemplatesFromContent();
const t = templates.find((x) => x.id === "rd-sim-01")!;

describe("adaptation_advisor", () => {
  it("مخرج صالح يُقبل؛ نوع غير مسموح يُرفض ويسقط إلى لا اقتراحات؛ أكثر من اثنين يُرفض", async () => {
    const good = JSON.stringify({ suggestions: [{ type: "change_daily_count", setting_key: "daily_mission_count", proposed_value: 2, reason_short: "تخليت عن نصف المهام", expected_effect: "مهام أقل وأعمق" }] });
    const r = await adviseAdaptation({ db: new FakeDb().client(), caller: fakeCaller([good]), profileId: "p", mode: "teen", stats: {}, currentSettings: {} });
    expect(r.source).toBe("ai");
    expect(r.suggestions[0]!.type).toBe("change_daily_count");
    const bad = JSON.stringify({ suggestions: [{ type: "leaderboard", setting_key: null, proposed_value: true, reason_short: "x", expected_effect: "y" }] });
    const db = new FakeDb();
    const r2 = await adviseAdaptation({ db: db.client(), caller: fakeCaller([bad, bad]), profileId: "p", mode: "teen", stats: {}, currentSettings: {} });
    expect(r2.source).toBe("fixed");
    expect(r2.suggestions).toHaveLength(0);
    expect(db.rows("ai_calls").every((c) => c.valid === false)).toBe(true);
    const many = JSON.stringify({ suggestions: [1, 2, 3].map((i) => ({ type: "change_daily_count", setting_key: "daily_mission_count", proposed_value: i, reason_short: "x", expected_effect: "y" })) });
    expect((await adviseAdaptation({ db: new FakeDb().client(), caller: fakeCaller([many, many]), profileId: "p", mode: "teen", stats: {}, currentSettings: {} })).source).toBe("fixed");
  });
  it("لغة التشخيص تُرفض", async () => {
    const diag = JSON.stringify({ suggestions: [{ type: "change_daily_count", setting_key: "daily_mission_count", proposed_value: 2, reason_short: "لديه اضطراب انتباه", expected_effect: "y" }] });
    expect((await adviseAdaptation({ db: new FakeDb().client(), caller: fakeCaller([diag, diag]), profileId: "p", mode: "teen", stats: {}, currentSettings: {} })).source).toBe("fixed");
  });
});

describe("template_drafter (ADAPT-7)", () => {
  it("النسخة تحتفظ بالمعرّف والميكانيكية والمستوى والقدرات، وتُرقَّم وتُعلَّم draft/ai_draft", async () => {
    const improved = { ...t, title: { child: "ركّز قليلًا", teen: "ركّز", adult: "ركّز" }, strategies: [...t.strategies] };
    const out = JSON.stringify({ template: improved, rationale: "مواقف أوضح" });
    const r = await draftTemplate({ db: new FakeDb().client(), caller: fakeCaller([out]), template: t, metrics: { shown_rate: 0.1 } });
    expect(r).not.toBeNull();
    expect(r!.draft).toMatchObject({ id: t.id, version: t.version + 1, status: "draft", origin: "ai_draft", mechanic: t.mechanic });
    expect(verifyDraft({ template: { ...t, mechanic: "resume" }, rationale: "x" }, t)).toBe("mechanic_changed");
    expect(verifyDraft({ template: { ...t, strategies: t.strategies.slice(0, 2) }, rationale: "x" }, t)).toBe(t.strategies.length > 2 ? "fewer_strategies" : null);
  });
  it("مخرج لا يطابق مخطط القالب يسقط إلى لا مسودة", async () => {
    const bad = JSON.stringify({ template: { ...t, capability_weights: { attention: 0.5 } }, rationale: "x" });
    expect(await draftTemplate({ db: new FakeDb().client(), caller: fakeCaller([bad, bad]), template: t, metrics: {} })).toBeNull();
  });
});
