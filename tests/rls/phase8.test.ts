/**
 * المرحلة 8 على قاعدة بيانات حقيقية: الدفعة (الحدود والأوضاع المفعّلة، المشرف فقط)، اللقطة الأسبوعية من بيانات فعلية،
 * تدقيق وصول المشرف (ADMIN-6)، حذف الحساب (8.4 والحالات الحدية)، أحداث منتج بلا محتوى، الجاهزية.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { evaluateAndRecord } from "../../src/modules/evidence/service";
import { afterMissionReflected } from "../../src/modules/game/service";
import { snapshotCohort, activeCohort, readiness } from "../../src/modules/trial/service";
import { track } from "../../src/modules/trial/analytics";
import { trial } from "../../src/shared/config";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = new RlsHarness();
let admin: TestUser, teen: TestUser, adult: TestUser, guardian: TestUser, childUser: TestUser, stranger: TestUser;
let teenProfile: string, adultProfile: string, childProfile: string;
let svc: SupabaseClient;

async function runMission(user: TestUser, profile: string) {
  return h.as(user, async (q) => {
    const id = (await q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level) values ($1,'rd-sim-01',1,2,'L1_hint') returning id`, [profile])).rows[0].id as string;
    await q(`select app.transition_mission($1,'chosen')`, [id]); await q(`update missions set strategy_chosen = 's1', time_estimate = 5 where id = $1`, [id]);
    await q(`select app.transition_mission($1,'planned')`, [id]); await q(`select app.transition_mission($1,'in_progress')`, [id]); await q(`select app.transition_mission($1,'completed')`, [id]);
    await q(`insert into reflections (mission_id, prompts_and_answers) values ($1, '[{"prompt":"س","answer":"ج"}]')`, [id]);
    await q(`select app.transition_mission($1,'reflected')`, [id]);
    return id;
  });
}

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  admin = await h.createUser("admin8@test.local", true);
  [teen, adult, guardian, childUser, stranger] = await Promise.all(["t8", "a8", "g8", "child8", "s8"].map((n) => h.createUser(`${n}@test.local`))) as [TestUser, TestUser, TestUser, TestUser, TestUser];
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','مراهق','teen') returning id`, [teen.id])).rows[0].id);
  adultProfile = await h.as(adult, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','بالغ','adult') returning id`, [adult.id])).rows[0].id);
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));
  await h.as(guardian, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','أم')`, [guardian.id]));
  childProfile = (await h.service<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','kid8','mother','2026-11-05.1') as id`, [childUser.id, guardian.id])).rows[0]!.id;
});
afterAll(() => h.teardown());

describe("الدفعة (القسم 14: 15–30 مستخدمًا على الأوضاع المفعّلة)", () => {
  let cohort: string;
  it("المشرف وحده ينشئ الدفعة ويسجّل المشاركين؛ الوضع غير المفعّل والتكرار والحد الأقصى تُرفض", async () => {
    expect(await h.failsAs(teen, `select app.create_trial_cohort('x', 4, array['teen']::age_mode[], 30)`)).toMatch(/not allowed/);
    cohort = await h.as(admin, async (q) => (await q(`select app.create_trial_cohort('الدفعة 1', $1, $2::age_mode[], 2) as id`, [trial.cohort.weeks, ["teen", "adult"]])).rows[0].id);
    await h.as(admin, (q) => q(`select app.enroll_trial_participant($1,$2)`, [cohort, teenProfile]));
    expect(await h.failsAs(admin, `select app.enroll_trial_participant($1,$2)`, [cohort, teenProfile])).toMatch(/already/);
    expect(await h.failsAs(admin, `select app.enroll_trial_participant($1,$2)`, [cohort, childProfile])).toMatch(/mode_disabled/);
    await h.as(admin, (q) => q(`select app.enroll_trial_participant($1,$2)`, [cohort, adultProfile]));
    expect(await h.failsAs(admin, `select app.enroll_trial_participant($1,$2)`, [cohort, (await h.service<{ id: string }>(`select id from profiles where user_id = $1`, [stranger.id])).rows[0]!.id])).toMatch(/cohort_full/);
    expect(await h.failsAs(teen, `select app.enroll_trial_participant($1,$2)`, [cohort, adultProfile])).toMatch(/not allowed/);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from trial_cohorts`)).rows[0].n)).toBe(0);
    expect(await h.as(admin, async (q) => (await q(`select count(*)::int as n from trial_participants where cohort_id = $1`, [cohort])).rows[0].n)).toBe(2);
  });
  it("اللقطة الأسبوعية تُحسب من بيانات فعلية وتُحفظ idempotent؛ التوزيع على الأوضاع", async () => {
    const m = await runMission(teen, teenProfile);
    await evaluateAndRecord(svc, m);
    await afterMissionReflected(svc, m);
    const c = (await activeCohort(svc))!;
    const r = await snapshotCohort(svc, c);
    expect(r.participants).toBe(2);
    expect(r.by_mode).toEqual({ teen: 1, adult: 1 });
    expect(r.metrics.map((x) => x.key)).toContain("transfer_rate");
    expect(r.week).toBe(1);
    await snapshotCohort(svc, c);
    expect(await h.as(admin, async (q) => (await q(`select count(*)::int as n from trial_metric_snapshots where cohort_id = $1`, [c.id])).rows[0].n)).toBe(1);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from trial_metric_snapshots`)).rows[0].n)).toBe(0);
  });
});

describe("تدقيق وصول المشرف والقياس المجهّل", () => {
  it("ADMIN-6: log_admin_access للمشرف فقط ويكتب في audit_log", async () => {
    await h.as(admin, (q) => q(`select app.log_admin_access('/admin/trial')`));
    expect(await h.failsAs(teen, `select app.log_admin_access('/admin')`)).toMatch(/not allowed/);
    const n = await h.service<{ n: number }>(`select count(*)::int as n from audit_log where action = 'admin_access' and actor_id = $1 and target = '/admin/trial'`, [admin.id]);
    expect(n.rows[0]!.n).toBe(1);
  });
  it("product_events: بلا نص حر وبلا معرّف ملف صريح؛ المشرف وحده يقرأ", async () => {
    expect(await track(svc, { event: "mission_reflected", profileId: teenProfile, props: { age_mode: "teen", gate2: "shown", reflection: "نص التأمل الكامل هنا" } }, null)).toBe(true);
    const rows = await h.service<{ profile_hash: string; props: Record<string, unknown> }>(`select profile_hash, props from product_events where event = 'mission_reflected'`);
    expect(rows.rows[0]!.props).toEqual({ age_mode: "teen", gate2: "shown" });
    expect(rows.rows[0]!.profile_hash).not.toBe(teenProfile);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as n from product_events`)).rows[0].n)).toBe(0);
    expect(await h.as(admin, async (q) => (await q(`select count(*)::int as n from product_events`)).rows[0].n)).toBeGreaterThan(0);
  });
  it("الجاهزية تكشف المتغيرات الناقصة وموارد الأمان غير المتحقق منها", async () => {
    const items = await readiness(svc, { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" } as unknown as NodeJS.ProcessEnv);
    expect(items.find((i) => i.key === "env:ANTHROPIC_API_KEY")!.ok).toBe(false);
    expect(items.find((i) => i.key === "safety_resources_verified")!.ok).toBe(false);
    expect(items.find((i) => i.key === "active_templates")!.ok).toBe(true);
  });
});

describe("حذف الحساب (8.4 + الحالات الحدية)", () => {
  it("الطفل لا يحذف حسابه؛ المربي المنشئ يحذفه؛ الغريب لا", async () => {
    expect(await h.failsAs(childUser, `select app.delete_player_account($1)`, [childProfile])).toMatch(/not allowed/);
    expect(await h.failsAs(stranger, `select app.delete_player_account($1)`, [childProfile])).toMatch(/not allowed/);
    const uid = await h.as(guardian, async (q) => (await q(`select app.delete_player_account($1) as u`, [childProfile])).rows[0].u);
    expect(uid).toBe(childUser.id);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from profiles where id = $1`, [childProfile])).rows[0]!.n).toBe(0);
  });
  it("المراهق يحذف حسابه فتتعاقب كل بياناته (مهام، أدلة، لقطات، مشاركته في الدفعة) ويبقى سجل تدقيق مجهّل", async () => {
    const before = await h.service<{ n: number }>(`select count(*)::int as n from missions where profile_id = $1`, [teenProfile]);
    expect(before.rows[0]!.n).toBeGreaterThan(0);
    await h.as(teen, (q) => q(`select app.delete_player_account($1)`, [teenProfile]));
    for (const t of ["missions", "evidence_events", "capability_snapshots", "xp_events", "trial_participants", "settings"]) {
      expect((await h.service<{ n: number }>(`select count(*)::int as n from ${t} where profile_id = $1`, [teenProfile])).rows[0]!.n, t).toBe(0);
    }
    const audit = await h.service<{ target: string }>(`select target from audit_log where action = 'account_deleted' order by at desc limit 1`);
    expect(audit.rows[0]!.target).not.toBe(teenProfile);
  });
});
