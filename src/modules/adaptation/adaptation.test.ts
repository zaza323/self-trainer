import { describe, it, expect } from "vitest";
import { computeStrategyOutcomes, bestStrategy, showMemoryInPlanning, recallLine, strategyKeyOf } from "./strategy-outcomes";
import { templateMetricsFrom } from "./template-metrics";
import { filterSuggestions, normalizeSuggestion, audienceFor, dedupeKeyOf } from "./advisor";
import { customization } from "@/shared/config";
import content from "@content/adaptation.ar.json";

const m = (over: Partial<Parameters<typeof computeStrategyOutcomes>[0][number]>) => ({ mechanic: "decompose", strategy_chosen: "s1", custom_strategy_label: null, custom_strategy: null, gate2: "shown" as const, completed_at: "2026-11-01T10:00:00Z", ...over });

describe("ذاكرة الاستراتيجيات (4.13.2، ADAPT-3)", () => {
  it("تُحسب من المهام المقيَّمة فقط، والمخصصة تحت تسميتها الموحدة", () => {
    const rows = computeStrategyOutcomes([
      m({}), m({ gate2: "partial", completed_at: "2026-11-02T10:00:00Z" }), m({ gate2: null }),
      m({ strategy_chosen: null, custom_strategy: "أقسمها", custom_strategy_label: "تقسيم" }),
      m({ strategy_chosen: null, custom_strategy: "أقسم الواجب", custom_strategy_label: "تقسيم", gate2: "not_yet" }),
    ]);
    expect(rows).toHaveLength(2);
    const s1 = rows.find((r) => r.strategy_key === "s1")!;
    expect(s1).toMatchObject({ uses: 2, shown_count: 1, partial_count: 1, last_used_at: "2026-11-02T10:00:00Z" });
    expect(rows.find((r) => r.strategy_key === "custom:تقسيم")).toMatchObject({ uses: 2, shown_count: 1 });
    expect(strategyKeyOf({ strategy_chosen: null, custom_strategy: null, custom_strategy_label: null })).toBeNull();
  });
  it("L0–L1: الأنجح بحد أدنى للاستخدام ونسبة الظهور من config؛ L2–L3: لا يُعرض شيء في التخطيط", () => {
    const cfg = customization.strategy_memory;
    const rows = computeStrategyOutcomes([...Array(cfg.min_uses_to_show).fill(0).map(() => m({})), m({ strategy_chosen: "s2", gate2: "not_yet" })]);
    expect(bestStrategy(rows, "decompose")?.strategy_key).toBe("s1");
    expect(bestStrategy(rows, "prioritize")).toBeNull();
    expect(bestStrategy(computeStrategyOutcomes([m({})]), "decompose")).toBeNull(); // أقل من الحد الأدنى
    expect(showMemoryInPlanning("L1_hint")).toBe(true);
    expect(showMemoryInPlanning("L2_ask")).toBe(false);
  });
  it("التأمل عند L2–L3: جملة الاستحضار من content بآخر استراتيجية ونتيجتها", () => {
    const rows = computeStrategyOutcomes([m({ gate2: "shown" }), m({ strategy_chosen: "s2", gate2: "not_yet", completed_at: "2026-11-03T10:00:00Z" })]);
    const line = recallLine(rows, "decompose", "teen", (k) => (k === "s2" ? "أؤجل الأسهل" : k))!;
    expect(line).toContain("أؤجل الأسهل");
    expect(line).toContain(content.strategy_memory.outcomes.not_yet);
    expect(recallLine(rows, "prioritize", "teen", (k) => k)).toBeNull();
  });
});

describe("فعالية القوالب (7.6، ADAPT-6)", () => {
  const cfg = customization.template_metrics;
  const mk = (n: number, over: Partial<Parameters<typeof templateMetricsFrom>[0][number]> = {}) => Array(n).fill(0).map(() => ({ template_id: "rd-sim-01", template_version: 1, status: "reflected", gate2: "shown" as const, prediction: { minutes: 10 }, actual_duration_min: 12, transferred: false, ...over }));
  it("النِّسب وخطأ التوقع", () => {
    const [r] = templateMetricsFrom([...mk(2), ...mk(1, { gate2: "partial" }), ...mk(1, { status: "abandoned", gate2: null, transferred: false }), ...mk(1, { status: "transferred", transferred: true })]);
    expect(r).toMatchObject({ missions_n: 5, shown_rate: 0.75, partial_rate: 0.25, abandon_rate: 0.2, transfer_rate: 0.2, avg_prediction_error: 0.2, flagged: false });
  });
  it("يُعلَّم عند ≥ الحد الأدنى ونسبة ظهور منخفضة، أو تخلٍ مرتفع؛ ولا يُعلَّم تحت الحد الأدنى", () => {
    const n = cfg.min_missions_to_evaluate;
    expect(templateMetricsFrom(mk(n, { gate2: "not_yet" }))[0]).toMatchObject({ flagged: true, flag_reasons: ["low_shown"] });
    expect(templateMetricsFrom(mk(n - 1, { gate2: "not_yet" }))[0]!.flagged).toBe(false);
    const abandon = [...mk(Math.ceil(n * 0.6), { status: "abandoned", gate2: null }), ...mk(Math.floor(n * 0.4))];
    expect(templateMetricsFrom(abandon)[0]!.flag_reasons).toContain("high_abandon");
    expect(templateMetricsFrom(mk(2, { status: "suggested" }))).toHaveLength(0);
  });
});

describe("اقتراحات التكيّف (7.3، ADAPT-4، ADAPT-5)", () => {
  const ctx = { mode: "teen" as const, currentValues: { daily_mission_count: 3, focus_capabilities: [], available_windows: [] }, rejectedKeys: new Set<string>(), pendingKeys: new Set<string>(), hasGuardian: true };
  const raw = (over: Partial<Parameters<typeof normalizeSuggestion>[0]> = {}) => ({ type: "change_daily_count", setting_key: "daily_mission_count", proposed_value: 2, reason_short: "تخليت عن النصف", expected_effect: "مهام أقل وأعمق", ...over });
  it("الأنواع المسموحة فقط ومفتاح الإعداد مطابق", () => {
    expect(normalizeSuggestion(raw({ type: "add_leaderboard", setting_key: null }), ctx)).toMatchObject({ ok: false, reason: "type_not_allowed" });
    expect(normalizeSuggestion(raw({ setting_key: "quiet_hours" }), ctx)).toMatchObject({ ok: false, reason: "setting_key_mismatch" });
    expect(normalizeSuggestion(raw(), ctx)).toMatchObject({ ok: true });
  });
  it("القيمة تُقص ضمن حدود الكتالوج ولا تُقترح القيمة الحالية", () => {
    const r = normalizeSuggestion(raw({ proposed_value: 99 }), { ...ctx, currentValues: { ...ctx.currentValues, daily_mission_count: 2 } });
    expect(r.ok && r.s.proposed_value).toBe((customization.catalog.daily_mission_count as { max: number }).max); // يُقص إلى الحد الأقصى
    expect(normalizeSuggestion(raw({ proposed_value: 99 }), ctx)).toMatchObject({ ok: false, reason: "no_change" }); // القص يساوي الحالي
    expect(normalizeSuggestion(raw({ proposed_value: 3 }), ctx)).toMatchObject({ ok: false, reason: "no_change" });
  });
  it("لا تكرار لاقتراح مرفوض خلال cooldown ولا لاقتراح معلق، وحد أقصى اثنان", () => {
    const key = dedupeKeyOf(raw());
    expect(normalizeSuggestion(raw(), { ...ctx, rejectedKeys: new Set([key]) })).toMatchObject({ ok: false, reason: "rejected_recently" });
    expect(normalizeSuggestion(raw(), { ...ctx, pendingKeys: new Set([key]) })).toMatchObject({ ok: false, reason: "already_pending" });
    const many = [raw(), raw({ type: "try_mechanic", setting_key: null, proposed_value: { mechanic: "resume" } }), raw({ type: "change_focus_capabilities", setting_key: "focus_capabilities", proposed_value: ["attention"] }), raw()];
    const r = filterSuggestions(many, ctx);
    expect(r.accepted).toHaveLength(customization.adaptation.max_suggestions_per_run);
    expect(r.rejected.map((x) => x.reason)).toEqual(expect.arrayContaining(["max_per_run", "duplicate_in_batch"]));
  });
  it("الجمهور: child → المربي؛ فكرة مهمة واقعية ودعم أكثر → المربي دائمًا؛ ولا دعم بلا مربٍ", () => {
    expect(audienceFor("change_daily_count", "child")).toBe("guardian");
    expect(audienceFor("change_daily_count", "adult")).toBe("owner");
    expect(audienceFor("real_mission_idea", "adult")).toBe("guardian");
    expect(normalizeSuggestion(raw({ type: "request_more_support", setting_key: null, proposed_value: { capability_id: "attention" } }), { ...ctx, hasGuardian: false })).toMatchObject({ ok: false, reason: "no_guardian" });
    expect(normalizeSuggestion(raw({ type: "try_mechanic", setting_key: null, proposed_value: { mechanic: "fly" } }), ctx)).toMatchObject({ ok: false, reason: "bad_mechanic" });
  });
});
