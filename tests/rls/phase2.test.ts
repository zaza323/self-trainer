/**
 * المرحلة 2 على قاعدة بيانات حقيقية: أ.11 اختبار 4 (حتمية إعادة الحساب) و5 (لا تكرار عند إعادة الإرسال)،
 * + RLS للأدلة والحالات واللقطات، + تهيئة capability_states، + الدعم/التدريب عبر مهام متتالية.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { evaluateAndRecord, recomputeSnapshots } from "../../src/modules/evidence/service";
import { support, game } from "../../src/shared/config";

const h = new RlsHarness();
let teen: TestUser, guardian: TestUser, stranger: TestUser;
let teenProfile: string;
let admin: ReturnType<typeof pgSupabaseShim>;

async function runMission(templateId: string, opts: { strategy?: string; custom?: string; prediction?: number; actual?: number; hints?: number; distractions?: string[]; interrupted?: boolean; abandon?: boolean; context?: string; difficulty?: number; support?: string } = {}) {
  const id = await h.as(teen, async (q) => (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, context_tag) values ($1,$2,1,$3,$4,$5) returning id`, [teenProfile, templateId, opts.difficulty ?? 2, opts.support ?? "L1_hint", opts.context ?? null])).rows[0].id);
  await h.as(teen, async (q) => {
    await q(`select app.transition_mission($1,'chosen')`, [id]);
    await q(`update missions set strategy_chosen = $2, custom_strategy = $3, time_estimate = 5, prediction = $4 where id = $1`, [id, opts.custom ? null : opts.strategy ?? "s1", opts.custom ?? null, opts.prediction ? JSON.stringify({ minutes: opts.prediction }) : null]);
    await q(`select app.transition_mission($1,'planned')`, [id]);
    await q(`select app.transition_mission($1,'in_progress')`, [id]);
    await q(`update missions set hints_used = $2, distraction_log = $3 where id = $1`, [id, opts.hints ?? 0, JSON.stringify((opts.distractions ?? []).map((c) => ({ at: "x", choice: c })))]);
    if (opts.interrupted) { await q(`select app.transition_mission($1,'interrupted')`, [id]); await q(`update missions set interruption_reasons = '[{"at":"x","reason":"r"}]' where id = $1`, [id]); await q(`select app.transition_mission($1,'in_progress')`, [id]); }
    await q(`select app.transition_mission($1,$2)`, [id, opts.abandon ? "abandoned" : "completed"]);
    if (opts.actual) await q(`update missions set actual_duration_min = $2 where id = $1`, [id, opts.actual]);
    await q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[{"prompt":"س","answer":"ج"}]')`, [id]);
    await q(`select app.transition_mission($1,'reflected')`, [id]);
  });
  return id as string;
}

beforeAll(async () => {
  await h.setup();
  admin = pgSupabaseShim(h.pool);
  teen = await h.createUser("t2@test.local");
  guardian = await h.createUser("g2@test.local");
  stranger = await h.createUser("s2@test.local");
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','مراهق','teen') returning id`, [teen.id])).rows[0].id);
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));
  await h.as(guardian, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','أم')`, [guardian.id]));
  const code = await h.as(teen, async (q) => (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'mother','{"view_progress":true}') returning code`, [teenProfile, teen.id])).rows[0].code);
  await h.as(guardian, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
});
afterAll(() => h.teardown());

describe("تهيئة الحالات وRLS", () => {
  it("ثماني حالات بالدعم الابتدائي للوضع (أ.5)", async () => {
    const rows = await h.as(teen, async (q) => (await q(`select capability_id, support_level, training_level, mastered from capability_states where profile_id = $1 order by capability_id`, [teenProfile])).rows);
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.support_level === support.initial_by_age_mode.teen && r.training_level === "simulated" && r.mastered === false)).toBe(true);
  });
  it("المتصفح لا يكتب أدلة ولا XP ولا حالات (GATE-4)", async () => {
    expect(await h.failsAs(teen, `insert into evidence_events (profile_id, capability_id, rule_id, source, type, value, weight, context_tag, support_level, config_version) values ($1,'attention','x','auto','strategy_fit',1,1,'in_app','L1_hint','v')`, [teenProfile])).toMatch(/row-level security|permission denied/);
    expect(await h.failsAs(teen, `insert into xp_events (profile_id, amount, reason, source_id) values ($1, 999, 'hack', 'x')`, [teenProfile])).toMatch(/row-level security|permission denied/);
    expect(await h.failsAs(teen, `update capability_states set support_level = 'L3_free' where profile_id = $1`, [teenProfile])).toMatch(/row-level security|permission denied/);
  });
});

describe("أ.11 اختبار 5 + 4 — التقييم عند reflected، إعادة الإرسال، إعادة الحساب", () => {
  let m1: string;
  it("المثال 1 على قاعدة البيانات: 5 أدلة، shown، 40 XP", async () => {
    m1 = await runMission("rd-sim-01", { strategy: "s1", distractions: ["ignore", "break_return"], hints: 0 });
    const r = await evaluateAndRecord(admin, m1, { candidates: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.6 }], now: new Date() });
    expect(r.events).toBe(5);
    expect(r.gate2).toBe("shown");
    expect(r.xp).toBe(40);
    const ev = await h.service<{ rule_id: string; weight: number; value: number }>(`select rule_id, weight, value from evidence_events where mission_id = $1 order by rule_id`, [m1]);
    expect(ev.rows.map((e) => [e.rule_id, Number(e.value), Number(e.weight)])).toEqual([["G2", 1, 0.4], ["G4", 0.6, 0.48], ["r1", 0.8, 0.8], ["r2", 0.8, 0.4], ["r3", 0.8, 0.8]]);
    const m = await h.service<{ gate2: string; gate2_score: number; context_tag: string }>(`select gate2, gate2_score, context_tag from missions where id = $1`, [m1]);
    expect(m.rows[0]).toMatchObject({ gate2: "shown", context_tag: "in_app" });
    expect(Number(m.rows[0]!.gate2_score)).toBe(0.8);
  });
  it("اختبار 5: إعادة التقييم نفسه مرتين → لا أدلة ولا XP مكررة", async () => {
    const before = await h.service<{ e: number; x: number }>(`select (select count(*)::int from evidence_events where mission_id = $1) as e, (select coalesce(sum(amount),0)::int from xp_events where source_id = $1::text) as x`, [m1]);
    await evaluateAndRecord(admin, m1, { candidates: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.6 }] });
    await evaluateAndRecord(admin, m1, { candidates: [{ capability_id: "self_awareness", type: "reflection_quality", value: 0.6 }] });
    const after = await h.service<{ e: number; x: number }>(`select (select count(*)::int from evidence_events where mission_id = $1) as e, (select coalesce(sum(amount),0)::int from xp_events where source_id = $1::text) as x`, [m1]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0]!.x).toBe(40);
  });
  it("اختبار 4: إعادة الحساب من الأدلة تعطي اللقطات نفسها حرفيًا", async () => {
    const now = new Date();
    const written = await h.service(`select capability_id, score, confidence, phrase_key from capability_snapshots where profile_id = $1 order by capability_id`, [teenProfile]);
    expect(written.rows).toHaveLength(8);
    const re = await recomputeSnapshots(admin, teenProfile, now);
    const re2 = await recomputeSnapshots(admin, teenProfile, now);
    expect(re).toEqual(re2);
    const again = await h.service(`select capability_id, score, confidence, phrase_key from capability_snapshots where profile_id = $1 order by capability_id`, [teenProfile]);
    expect(again.rows).toEqual(written.rows);
    const att = again.rows.find((r) => r.capability_id === "attention")!;
    expect(att.score).toBeGreaterThan(50);
  });
  it("الأدلة واللقطات مقروءة للمالك والمربي (view_progress) لا للغريب", async () => {
    expect(await h.as(guardian, async (q) => (await q(`select count(*)::int as n from evidence_events where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(5);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from evidence_events`)).rows[0].n)).toBe(0);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from capability_snapshots where profile_id = $1`, [teenProfile])).rows[0].n)).toBe(8);
  });
  it("الأدلة غير قابلة للتعديل أو الحذف حتى بصلاحيات الخدمة (append-only)", async () => {
    await expect(h.service(`update evidence_events set value = 0 where mission_id = $1`, [m1])).rejects.toThrow(/append-only/);
    await expect(h.service(`delete from xp_events where source_id = $1`, [m1])).rejects.toThrow(/append-only/);
  });
});

describe("أ.5 / أ.6 عبر مهام متتالية", () => {
  it("بعد 3 مهام simulated shown للانتباه: التدريب يرتفع إلى guided_real (الثقة ≥ 0.35) والدعم يرتفع إلى L2 بعد الشروط", async () => {
    await evaluateAndRecord(admin, await runMission("rd-sim-01", { strategy: "s3", distractions: ["ignore", "ignore"], context: "in_app" }));
    await evaluateAndRecord(admin, await runMission("rd-sim-01", { strategy: "s1", distractions: ["ignore", "ignore"], context: "in_app" }));
    const st = await h.service<{ training_level: string; support_level: string }>(`select training_level, support_level from capability_states where profile_id = $1 and capability_id = 'attention'`, [teenProfile]);
    expect(st.rows[0]!.training_level).toBe("guided_real");
    expect(st.rows[0]!.support_level).toBe("L2_ask");
  });
  it("المثال 2 على القاعدة: partial وG3 لا يُطبَّق لأن home سبق (بعد مهمة أولى فيه)", async () => {
    const first = await runMission("pa-real-01", { strategy: "s3", prediction: 20, actual: 20, context: "home", support: "L2_ask", difficulty: 3 });
    const r0 = await evaluateAndRecord(admin, first);
    expect(r0.events).toBeGreaterThanOrEqual(3); // r1, r2, G2, G3 (سياق جديد)
    const m2 = await runMission("pa-real-01", { custom: "أرتب كل شيء بسرعة", prediction: 20, actual: 25, hints: 1, interrupted: true, context: "home", support: "L2_ask", difficulty: 3 });
    // السقف اليومي (أ.8): مجموع اليوم لا يتجاوز الحد مهما تعددت المهام
    const todaySum = await h.service<{ x: number }>(`select coalesce(sum(amount),0)::int as x from xp_events where profile_id = $1`, [teenProfile]);
    expect(todaySum.rows[0]!.x).toBeLessThanOrEqual(game.xp.daily_cap);
    const tomorrow = new Date(Date.now() + 86400000);
    const r = await evaluateAndRecord(admin, m2, { customStrategyFit: 0.0, candidates: [{ capability_id: "thinking", type: "reflection_quality", value: 0.7 }], now: tomorrow });
    expect(r.events).toBe(5);
    expect(r.gate2).toBe("partial");
    expect(Math.abs(r.gate2_score - 0.3947)).toBeLessThanOrEqual(0.0001);
    expect(r.xp).toBe(35);
  });
});
