/**
 * المرحلة 7 على قاعدة بيانات حقيقية — معيار القبول: اقتراح مقبول يغيّر الإعداد مع سجل؛ اقتراح مرفوض لا يتكرر 30 يومًا؛ القالب الضعيف يُعلَّم.
 * + من يقرر (child → المربي)، ذاكرة الاستراتيجيات وتلميح المحرك، مسودة القالب وقرار المشرف.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { runAdvisorForProfile, computeTemplateMetrics, recomputeStrategyOutcomes, expireSuggestions } from "../../src/modules/adaptation/service";
import { customization } from "../../src/shared/config";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = new RlsHarness();
let teen: TestUser, guardian: TestUser, childUser: TestUser, admin: TestUser, stranger: TestUser;
let teenProfile: string, childProfile: string;
let svc: SupabaseClient;
const TZ = "Asia/Amman";
const prof = (id: string, mode: "teen" | "child", user: TestUser) => ({ id, user_id: user.id, age_mode: mode, display_name: "x", kind: "player", timezone: TZ });
const daily = (v: number) => [{ type: "change_daily_count", setting_key: "daily_mission_count", proposed_value: v, reason_short: "تخليت عن نصف المهام", expected_effect: "مهام أقل وأعمق" }];

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  teen = await h.createUser("t7@test.local");
  guardian = await h.createUser("g7@test.local");
  childUser = await h.createUser("child7@child.local");
  admin = await h.createUser("a7@test.local", true);
  stranger = await h.createUser("s7@test.local");
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','مراهق','teen',$2) returning id`, [teen.id, TZ])).rows[0].id);
  await h.as(guardian, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','أم')`, [guardian.id]));
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));
  childProfile = (await h.service<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','kid7','mother','2026-11-05.1') as id`, [childUser.id, guardian.id])).rows[0]!.id;
});
afterAll(() => h.teardown());

describe("معيار القبول: اقتراح مقبول يغيّر الإعداد مع سجل؛ المرفوض لا يتكرر 30 يومًا", () => {
  it("المستشار يحفظ الاقتراح (مقصوصًا ضمن الكتالوج) ويُخطر صاحب القرار", async () => {
    const r = await runAdvisorForProfile(svc, { enabled: false } as never, prof(teenProfile, "teen", teen), new Date(), daily(0));
    expect(r.created).toHaveLength(1);
    expect(r.created[0]!.proposed_value).toBe((customization.catalog.daily_mission_count as { min: number }).min); // 0 يُقص إلى الحد الأدنى
    const notif = await h.service<{ n: number }>(`select count(*)::int as n from notifications where profile_id = $1 and type = 'adaptation_suggestion'`, [teenProfile]);
    expect(notif.rows[0]!.n).toBe(1);
  });
  it("المراهق يرى اقتراحه، الغريب لا؛ القبول يكتب الإعداد في طبقته بمصدر تدقيق adaptation_suggestion", async () => {
    await h.service(`delete from adaptation_suggestions where profile_id = $1`, [teenProfile]);
    const r = await runAdvisorForProfile(svc, { enabled: false } as never, prof(teenProfile, "teen", teen), new Date(), daily(2));
    const id = (await h.service<{ id: string }>(`select id from adaptation_suggestions where profile_id = $1`, [teenProfile])).rows[0]!.id;
    expect(r.created).toHaveLength(1);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from adaptation_suggestions where id = $1`, [id])).rows[0].n)).toBe(0);
    expect(await h.failsAs(stranger, `select app.decide_adaptation_suggestion($1,'accepted')`, [id])).toMatch(/not allowed/);
    await h.as(teen, (q) => q(`select app.decide_adaptation_suggestion($1,'accepted')`, [id]));
    const eff = await h.service<{ v: unknown }>(`select app.setting_effective($1,'daily_mission_count') as v`, [teenProfile]);
    expect(eff.rows[0]!.v).toBe(2);
    const audit = await h.service<{ source: string; actor_role: string }>(`select source, actor_role from settings_audit where profile_id = $1 and key = 'daily_mission_count' order by at desc limit 1`, [teenProfile]);
    expect(audit.rows[0]).toMatchObject({ source: "adaptation_suggestion", actor_role: "player" });
    expect(await h.failsAs(teen, `select app.decide_adaptation_suggestion($1,'accepted')`, [id])).toMatch(/already decided/);
  });
  it("الرفض يُسجل، والاقتراح نفسه لا يُنشأ ثانية خلال cooldown، ويُنشأ بعد انقضائه", async () => {
    const now = new Date();
    const r1 = await runAdvisorForProfile(svc, { enabled: false } as never, prof(teenProfile, "teen", teen), now, daily(1));
    expect(r1.created).toHaveLength(1);
    const id = (await h.service<{ id: string }>(`select id from adaptation_suggestions where profile_id = $1 and decision is null`, [teenProfile])).rows[0]!.id;
    await h.as(teen, (q) => q(`select app.decide_adaptation_suggestion($1,'rejected')`, [id]));
    const r2 = await runAdvisorForProfile(svc, { enabled: false } as never, prof(teenProfile, "teen", teen), now, daily(1));
    expect(r2.created).toHaveLength(0);
    expect(r2.rejected).toBe(1);
    const later = new Date(now.getTime() + (customization.adaptation.reject_cooldown_days + 1) * 86400000);
    const r3 = await runAdvisorForProfile(svc, { enabled: false } as never, prof(teenProfile, "teen", teen), later, daily(1));
    expect(r3.created).toHaveLength(1);
    expect(await expireSuggestions(svc, new Date(later.getTime() + (customization.adaptation.expire_after_days + 1) * 86400000))).toBeGreaterThan(0);
  });
  it("في child يقرر المربي لا الطفل، والقبول يكتب طبقة المربي", async () => {
    await runAdvisorForProfile(svc, { enabled: false } as never, prof(childProfile, "child", childUser), new Date(), daily(1));
    const id = (await h.service<{ id: string; audience: string }>(`select id, audience from adaptation_suggestions where profile_id = $1`, [childProfile])).rows[0]!;
    expect(id.audience).toBe("guardian");
    expect(await h.failsAs(childUser, `select app.decide_adaptation_suggestion($1,'accepted')`, [id.id])).toMatch(/not allowed/);
    await h.as(guardian, (q) => q(`select app.decide_adaptation_suggestion($1,'accepted')`, [id.id]));
    const row = await h.service<{ set_by_role: string; value: unknown }>(`select set_by_role, value from settings where profile_id = $1 and key = 'daily_mission_count'`, [childProfile]);
    expect(row.rows[0]).toMatchObject({ set_by_role: "guardian", value: 1 });
    const gn = await h.service<{ n: number }>(`select count(*)::int as n from notifications where profile_id = $1 and type = 'adaptation_suggestion' and payload->>'guardian_id' = $2`, [childProfile, guardian.id]);
    expect(gn.rows[0]!.n).toBe(1);
  });
});

describe("فعالية القوالب ومسوداتها (ADAPT-6، ADAPT-7، ADMIN-5)", () => {
  it("القالب الضعيف يُعلَّم بعد الحد الأدنى من المهام ويُسجَّل في التدقيق؛ المشرف وحده يرى المقاييس", async () => {
    const n = customization.template_metrics.min_missions_to_evaluate;
    for (let i = 0; i < n; i++) {
      await h.as(teen, async (q) => {
        const id = (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,'rd-sim-01',1,2,'L1_hint') returning id`, [teenProfile])).rows[0].id;
        await q(`select app.transition_mission($1,'chosen')`, [id]); await q(`select app.transition_mission($1,'planned')`, [id]); await q(`select app.transition_mission($1,'in_progress')`, [id]); await q(`select app.transition_mission($1,'abandoned')`, [id]);
      });
    }
    const r = await computeTemplateMetrics(svc);
    expect(r.flagged).toContain("rd-sim-01:1");
    const m = await h.service<{ flagged: boolean; abandon_rate: number; flag_reasons: string[] }>(`select flagged, abandon_rate, flag_reasons from template_metrics where template_id = 'rd-sim-01' and template_version = 1`);
    expect(m.rows[0]).toMatchObject({ flagged: true, abandon_rate: 1 });
    expect(m.rows[0]!.flag_reasons).toContain("high_abandon");
    expect((await h.service<{ n: number }>(`select count(*)::int as n from audit_log where action = 'template_flagged'`)).rows[0]!.n).toBe(1);
    await computeTemplateMetrics(svc); // لا تسجيل مكرر
    expect((await h.service<{ n: number }>(`select count(*)::int as n from audit_log where action = 'template_flagged'`)).rows[0]!.n).toBe(1);
    expect(await h.as(admin, async (q) => (await q(`select count(*)::int as n from template_metrics`)).rows[0].n)).toBeGreaterThan(0);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from template_metrics`)).rows[0].n)).toBe(0);
  });
  it("مسودة القالب: المشرف يعتمدها فتصبح نشطة والقديمة retired؛ أو يرفضها؛ المهام الجارية تبقى بنسختها", async () => {
    await h.service(`insert into mission_templates (id, version, mechanic_id, training_level, difficulty, age_modes, title_by_mode, situation_by_mode, strategies, reflection_prompts, evidence_rules, completion_check, min_duration, max_duration, status, origin)
      select id, 2, mechanic_id, training_level, difficulty, age_modes, title_by_mode, situation_by_mode, strategies, reflection_prompts, evidence_rules, completion_check, min_duration, max_duration, 'draft', 'ai_draft' from mission_templates where id = 'rd-sim-01' and version = 1`);
    await h.service(`insert into template_capabilities (template_id, template_version, capability_id, weight) select template_id, 2, capability_id, weight from template_capabilities where template_id = 'rd-sim-01' and template_version = 1`);
    await h.service(`insert into template_draft_reviews (template_id, template_version, source_version, rationale) values ('rd-sim-01', 2, 1, 'مواقف أوضح')`);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from mission_templates where id = 'rd-sim-01' and version = 2`)).rows[0].n)).toBe(0); // المسودة للمشرف فقط
    expect(await h.failsAs(teen, `select app.review_template_draft('rd-sim-01', 2, 'approved')`)).toMatch(/not allowed/);
    await h.as(admin, (q) => q(`select app.review_template_draft('rd-sim-01', 2, 'approved', 'جيد')`));
    const st = await h.service<{ version: number; status: string }>(`select version, status from mission_templates where id = 'rd-sim-01' order by version`);
    expect(st.rows.map((r) => [r.version, r.status])).toEqual([[1, "retired"], [2, "active"]]);
    const old = await h.service<{ n: number }>(`select count(*)::int as n from missions where template_id = 'rd-sim-01' and template_version = 1`);
    expect(old.rows[0]!.n).toBeGreaterThan(0);
    expect(await h.failsAs(admin, `select app.review_template_draft('rd-sim-01', 2, 'rejected')`)).toMatch(/not pending/);
  });
});

describe("ذاكرة الاستراتيجيات وتلميح المحرك", () => {
  it("تُحسب من المهام المقيَّمة ويراها المالك والمربي بـ view_progress لا الغريب", async () => {
    for (let i = 0; i < 3; i++) {
      const id = await h.as(teen, async (q) => {
        const mid = (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,'rd-sim-01',2,2,'L1_hint') returning id`, [teenProfile])).rows[0].id as string;
        await q(`select app.transition_mission($1,'chosen')`, [mid]);
        await q(`update missions set strategy_chosen = 's1', time_estimate = 5 where id = $1`, [mid]);
        await q(`select app.transition_mission($1,'planned')`, [mid]); await q(`select app.transition_mission($1,'in_progress')`, [mid]); await q(`select app.transition_mission($1,'completed')`, [mid]);
        await q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[]'::jsonb)`, [mid]);
        await q(`select app.transition_mission($1,'reflected')`, [mid]);
        return mid;
      });
      await h.service(`update missions set gate2 = 'shown' where id = $1`, [id]); // المحرك (service role)
    }
    const rows = await recomputeStrategyOutcomes(svc, teenProfile);
    expect(rows.find((r) => r.strategy_key === "s1")?.uses).toBeGreaterThanOrEqual(3);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from strategy_outcomes where profile_id = $1`, [teenProfile])).rows[0].n)).toBeGreaterThan(0);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from strategy_outcomes where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(0);
  });
});
