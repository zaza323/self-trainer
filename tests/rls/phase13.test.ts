/**
 * المرحلة 13 (0.5 الجزء أ) على قاعدة بيانات حقيقية — اختبارات أ.10:
 * 1 مصدر متغير السيناريو (ref صالح يخص المستخدم نفسه)، 4 من تخطّى التعارف، 6 المحتوى الممنوع لا يُحفظ، 7 الخصوصية (RLS)،
 * 8 التعارف بالعلم AI_ENABLED=false (J2)، 9 لا XP ولا أدلة، 10 «ما تغيّر» لا يكتب إلا التأكيد، 11 العنصر المتقادم لا يُستخدم.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { ai } from "../../src/shared/config";
import { anthropicCaller } from "../../src/lib/ai/client";
import { fakeCaller } from "../../src/modules/companion/runtime";
import { lifeIntakeAssist } from "../../src/modules/lifelog/intake-ai";
import * as life from "../../src/modules/lifelog/service";
import { lifeConfig, SCENARIO_VARIABLE } from "../../src/modules/lifelog/rules";
import { ensureDailySuggestions } from "../../src/modules/engine/service";
import { createTask } from "../../src/modules/planner/service";
import { todayIn } from "../../src/modules/missions/queries";
import { addDays } from "../../src/modules/planner/recurrence";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileRow } from "../../src/shared/db/types";

const h = new RlsHarness();
const TZ = "Asia/Amman";
let teen: TestUser, other: TestUser, skipper: TestUser, creator: TestUser, childUser: TestUser, teenGuardian: TestUser;
let teenP: string, otherP: string, skipP: string, childP: string;
let svc: SupabaseClient, teenDb: SupabaseClient, otherDb: SupabaseClient, skipDb: SupabaseClient, creatorDb: SupabaseClient;
const count = async (sql: string, p: unknown[]) => (await h.service<{ n: number }>(sql, p)).rows[0]!.n;
const profileRow = async (id: string) => (await h.service<ProfileRow>(`select * from profiles where id = $1`, [id])).rows[0]!;
const guidedReal = (id: string) => h.service(`insert into capability_states (profile_id, capability_id, support_level, training_level) select $1, id, 'L1_hint', 'guided_real' from capabilities on conflict (profile_id, capability_id) do update set training_level = 'guided_real'`, [id]);
const missionsOf = async (id: string) => (await h.service<{ id: string; template_id: string; life_binding: string; variables: Record<string, string>; variables_provenance: Array<{ name: string; ref_type: string; ref_id: string | null }> | null }>(
  `select m.id, m.template_id, t.life_binding, m.variables, m.variables_provenance from missions m join mission_templates t on t.id = m.template_id and t.version = m.template_version where m.profile_id = $1`, [id])).rows;
const REQUIRED = `insert into missions (profile_id, template_id, template_version, difficulty, support_level, source, variables, variables_provenance) values ($1, 'pa-real-01', 1, 3, 'L1_hint', 'engine', $2::jsonb, $3::jsonb)`;

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  teen = await h.createUser("t13@test.local"); other = await h.createUser("o13@test.local"); skipper = await h.createUser("s13@test.local");
  creator = await h.createUser("c13@test.local"); childUser = await h.createUser("child13@child.local"); teenGuardian = await h.createUser("tg13@test.local");
  const mk = (u: TestUser, mode: string) => h.as(u, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','x',$2,$3) returning id`, [u.id, mode, TZ])).rows[0].id as string);
  teenP = await mk(teen, "teen"); otherP = await mk(other, "adult"); skipP = await mk(skipper, "teen");
  for (const g of [creator, teenGuardian]) await h.as(g, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','مربي')`, [g.id]));
  childP = (await h.service<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','k13','mother','2026-11-05.1') as id`, [childUser.id, creator.id])).rows[0]!.id;
  const code = await h.as(teen, async (q) => (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'teacher',$3) returning code`, [teenP, teen.id, { view_progress: true, manage_settings: true }])).rows[0].code);
  await h.as(teenGuardian, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
  teenDb = pgSupabaseShim(h.pool, teen); otherDb = pgSupabaseShim(h.pool, other); skipDb = pgSupabaseShim(h.pool, skipper); creatorDb = pgSupabaseShim(h.pool, creator);
});
afterAll(() => h.teardown());

describe("أ.10-8 (J2) و9: التعارف بالنموذج الثابت والعلم AI_ENABLED=false، بلا XP ولا أدلة", () => {
  const prevFlag = process.env[ai.ai_off.flag_env], prevKey = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { process.env[ai.ai_off.flag_env] = "false"; process.env.ANTHROPIC_API_KEY = "dummy-key-flag-test"; });
  afterAll(() => { if (prevFlag === undefined) delete process.env[ai.ai_off.flag_env]; else process.env[ai.ai_off.flag_env] = prevFlag; if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });

  it("الرحلة كاملة يدويًا: أدوار ← مسؤوليات ← من يعتمد ← ضغط ← «تمام»؛ المساعد لا يُستدعى", async () => {
    const xpBefore = await count(`select count(*)::int as n from xp_events where profile_id = $1`, [teenP]);
    const evBefore = await count(`select count(*)::int as n from evidence_events where profile_id = $1`, [teenP]);
    const off = anthropicCaller(); expect(off.enabled).toBe(false);
    const assist = await lifeIntakeAssist({ db: svc, caller: off, profileId: teenP, mode: "teen", field: "responsibilities", userMessage: "أسلّم مشروع التخرج آخر الشهر", existing: [], allowFollowUp: true });
    expect(assist).toEqual({ candidates: [], followUp: null, source: "fixed" });
    const add = (field: Parameters<typeof life.addLifeItem>[1]["field"], text: string) => life.addLifeItem(teenDb, { profileId: teenP, actorId: teen.id, field, text, source: "user_typed" });
    expect((await add("roles", "طالب/ة")).ok).toBe(true);
    expect((await life.loadLife(teenDb, teenP)).intake_status).toBe("partial");   // التقدم يُحفظ بندًا بندًا
    expect((await add("responsibilities", "أسلّم مشروع التخرج آخر الشهر")).ok).toBe(true);
    expect((await add("dependents", "أخي الصغير")).ok).toBe(true);
    expect((await add("pressures", "آخر الأسبوع")).ok).toBe(true);
    await life.setIntakeStep(teenDb, { profileId: teenP, actorId: teen.id, step: 5 });
    expect((await life.completeIntake(teenDb, { profileId: teenP, actorId: teen.id })).ok).toBe(true);
    const row = await life.loadLife(teenDb, teenP);
    expect(row.intake_status).toBe("done"); expect(row.intake_completed_at).not.toBeNull();
    expect(row.log.responsibilities[0]).toMatchObject({ text: "أسلّم مشروع التخرج آخر الشهر", source: "user_typed", archived: false });
    expect(await count(`select count(*)::int as n from ai_calls where profile_id = $1`, [teenP])).toBe(0);
    // أ.10-9: التعارف لا يولّد XP ولا أدلة
    expect(await count(`select count(*)::int as n from xp_events where profile_id = $1`, [teenP])).toBe(xpBefore);
    expect(await count(`select count(*)::int as n from evidence_events where profile_id = $1`, [teenP])).toBe(evBefore);
  });
});

describe("أ.10-2 و6 على الخادم: المرشح غير الحرفي والمحتوى الممنوع لا يصلان للحفظ", () => {
  it("مخرج المساعد: المؤلَّف يُحذف والحرفي يبقى مرشحًا فقط (لا يدخل السجل)", async () => {
    const out = JSON.stringify({ candidates: [{ field: "responsibilities", text: "أراجع للاختبار كل ليلة" }, { field: "responsibilities", text: "مذاكرة يومية للامتحانات" }], follow_up: null });
    const r = await lifeIntakeAssist({ db: svc, caller: fakeCaller([out]), profileId: otherP, mode: "adult", field: "responsibilities", userMessage: "لازم أراجع للاختبار كل ليلة", existing: [], allowFollowUp: true });
    expect(r.candidates).toEqual([{ field: "responsibilities", text: "أراجع للاختبار كل ليلة" }]);
    expect((await life.loadLife(otherDb, otherP)).log.responsibilities).toEqual([]);
  });
  it("صحة أو اسم غريب أو موقع دقيق ⇒ مرفوض والسجل كما هو", async () => {
    for (const t of ["آخذ دواء السكري كل يوم", "أدرس مع صديقي سامي", "أروح على شارع الجامعة عمارة 12"]) {
      expect(await life.addLifeItem(otherDb, { profileId: otherP, actorId: other.id, field: "responsibilities", text: t, source: "user_typed" })).toMatchObject({ ok: false, error: "blocked" });
    }
    expect(await count(`select count(*)::int as n from personal_context where profile_id = $1 and jsonb_array_length(responsibilities) > 0`, [otherP])).toBe(0);
  });
});

describe("أ.10-1: قالب required لا يُنتج مهمة إلا بمرجع صالح يخص المستخدم نفسه", () => {
  it("بلا مرجع، أو بمرجع لمستخدم آخر، أو لعنصر غير موجود ⇒ مرفوض؛ بمرجعه هو ⇒ مقبول", async () => {
    const mine = (await life.loadLife(teenDb, teenP)).log.responsibilities[0]!.id;
    await life.addLifeItem(otherDb, { profileId: otherP, actorId: other.id, field: "responsibilities", text: "أحضّر عرض العمل", source: "user_typed" });
    const theirs = (await life.loadLife(otherDb, otherP)).log.responsibilities[0]!.id;
    const prov = (ref_type: string, ref_id: string | null) => JSON.stringify([{ name: SCENARIO_VARIABLE, ref_type, ref_id }]);
    const vars = JSON.stringify({ time_budget: 20, [SCENARIO_VARIABLE]: "x" });
    await expect(h.service(REQUIRED, [teenP, vars, null])).rejects.toThrow(/life_binding_required/);
    await expect(h.service(REQUIRED, [teenP, vars, "[]"])).rejects.toThrow(/life_binding_required/);
    await expect(h.service(REQUIRED, [teenP, vars, prov("life_entry", theirs)])).rejects.toThrow(/provenance_ref_invalid/);
    await expect(h.service(REQUIRED, [teenP, vars, prov("life_entry", "00000000-0000-4000-8000-00000000dead")])).rejects.toThrow(/provenance_ref_invalid/);
    await expect(h.service(REQUIRED, [teenP, vars, prov("invented", null)])).rejects.toThrow(/provenance_ref_invalid/);
    const otherTask = (await createTask(otherDb, { profileId: otherP, title: "مهمة غيري", due_date: "2026-12-01", weekStart: "sat", tz: TZ } as never) as { ok: true; data: { id: string } }).data.id;
    await expect(h.service(REQUIRED, [teenP, vars, prov("planner_task", otherTask)])).rejects.toThrow(/provenance_ref_invalid/);
    await h.service(REQUIRED, [teenP, vars, prov("life_entry", mine)]);
    await h.service(REQUIRED, [teenP, vars, prov("user_typed", null)]);
    expect(await count(`select count(*)::int as n from missions where profile_id = $1 and template_id = 'pa-real-01'`, [teenP])).toBe(2);
  });
  it("لا كتابة مباشرة من المتصفح على variables_provenance (إدراجًا أو تعديلًا)", async () => {
    const mine = (await life.loadLife(teenDb, teenP)).log.responsibilities[0]!.id;
    const p = JSON.stringify([{ name: SCENARIO_VARIABLE, ref_type: "life_entry", ref_id: mine }]);
    expect(await h.failsAs(teen, `insert into missions (profile_id, template_id, template_version, difficulty, support_level, variables_provenance) values ($1,'rd-sim-01',1,2,'L1_hint',$2::jsonb)`, [teenP, p])).toMatch(/written by the server only/);
    const mid = (await h.service<{ id: string }>(`select id from missions where profile_id = $1 limit 1`, [teenP])).rows[0]!.id;
    expect(await h.failsAs(teen, `update missions set variables_provenance = '[]'::jsonb where id = $1`, [mid])).toMatch(/written by the server only/);
  });
  it("المحرك: المهمة المرتبطة تحمل نص عنصر المستخدم ومرجعه، ولا نص من عند النظام", async () => {
    await h.service(`delete from missions where profile_id = $1`, [teenP]);
    await guidedReal(teenP);
    const n = await ensureDailySuggestions(teenDb, await profileRow(teenP), svc);
    expect(n).toBeGreaterThan(0);
    const bound = (await missionsOf(teenP)).filter((m) => m.life_binding !== "none");
    expect(bound.length).toBeGreaterThan(0);
    const mine = (await life.loadLife(teenDb, teenP)).log.responsibilities.map((x) => x.id);
    for (const m of bound) {
      expect(m.variables_provenance).toHaveLength(1);
      expect(m.variables_provenance![0]).toMatchObject({ name: SCENARIO_VARIABLE, ref_type: "life_entry" });
      expect(mine).toContain(m.variables_provenance![0]!.ref_id);
      expect(m.variables[SCENARIO_VARIABLE]).toBe("أسلّم مشروع التخرج آخر الشهر");
    }
  });
});

describe("أ.10-4: من تخطّى التعارف", () => {
  it("كل المهام المقترحة life_binding = none؛ وبعد مهمة مخطط كتبها هو يُسمح بمرتبطة بها فقط", async () => {
    expect((await life.skipIntake(skipDb, { profileId: skipP, actorId: skipper.id })).ok).toBe(true);
    await guidedReal(skipP);
    await ensureDailySuggestions(skipDb, await profileRow(skipP), svc);
    const first = await missionsOf(skipP);
    expect(first.every((m) => m.life_binding === "none" && m.variables_provenance === null && !(SCENARIO_VARIABLE in m.variables))).toBe(true);
    await h.service(`delete from missions where profile_id = $1`, [skipP]);
    const today = todayIn(TZ);
    const tid = (await createTask(skipDb, { profileId: skipP, title: "اختبار الفيزياء", due_date: addDays(today, 2), weekStart: "sat", tz: TZ } as never) as { ok: true; data: { id: string } }).data.id;
    await ensureDailySuggestions(skipDb, await profileRow(skipP), svc);
    const second = await missionsOf(skipP);
    expect(second.length).toBeGreaterThan(0);
    for (const m of second) {
      if (m.life_binding === "none") { expect(m.variables_provenance).toBeNull(); continue; }
      expect(m.variables_provenance).toEqual([{ name: SCENARIO_VARIABLE, ref_type: "planner_task", ref_id: tid }]);
      expect(m.variables[SCENARIO_VARIABLE]).toBe("اختبار الفيزياء");
    }
    expect(second.some((m) => m.life_binding !== "none")).toBe(true);
  });
});

describe("أ.10-11: عنصر مضى على تأكيده أكثر من 60 يومًا", () => {
  it("لا يدخل المصادر حتى يُؤكَّد بلمسة", async () => {
    const stale = new Date(Date.now() - (lifeConfig.refresh.stale_after_days + 2) * 86400000).toISOString();
    await h.service(`update personal_context set responsibilities = (select jsonb_agg(jsonb_set(e, '{last_confirmed_at}', to_jsonb($2::text))) from jsonb_array_elements(responsibilities) e) where profile_id = $1`, [teenP, stale]);
    const now = new Date(), today = todayIn(TZ);
    expect((await life.scenarioSourcesFor(teenDb, teenP, { now, today })).sources.filter((s) => s.ref_type === "life_entry")).toEqual([]);
    const id = (await life.loadLife(teenDb, teenP)).log.responsibilities[0]!.id;
    await life.confirmLifeItem(teenDb, { profileId: teenP, actorId: teen.id, field: "responsibilities", id });
    expect((await life.scenarioSourcesFor(teenDb, teenP, { now: new Date(), today })).sources.some((s) => s.ref_id === id)).toBe(true);
  });
});

describe("أ.10-10: «ما تغيّر»", () => {
  it("لا يكتب شيئًا عدا last_confirmed_at (ووقت آخر تجديد)", async () => {
    const strip = (r: Record<string, unknown>) => JSON.stringify(r, (k, v) => (["last_confirmed_at", "last_refresh_at", "updated_at", "updated_by"].includes(k) ? undefined : v));
    const before = (await h.service(`select * from personal_context where profile_id = $1`, [teenP])).rows[0]!;
    const at = new Date("2027-01-01T00:00:00Z");
    expect((await life.confirmNothingChanged(teenDb, { profileId: teenP, actorId: teen.id, now: at })).ok).toBe(true);
    const after = (await h.service(`select * from personal_context where profile_id = $1`, [teenP])).rows[0]!;
    expect(strip(after)).toEqual(strip(before));
    const row = await life.loadLife(teenDb, teenP);
    expect(row.last_refresh_at && new Date(row.last_refresh_at).toISOString()).toBe(at.toISOString());
    for (const f of ["roles", "responsibilities", "dependents", "pressures"] as const) for (const x of row.log[f]) expect(x.last_confirmed_at).toBe(at.toISOString());
  });
});

describe("أ.10-7: الخصوصية (RLS)", () => {
  it("teen بلا مشاركة: مربيه (حتى بـ manage_settings) لا يقرأ النصوص ولا يكتب، ويرى الأعداد فقط", async () => {
    expect(await h.as(teenGuardian, async (q) => (await q(`select count(*)::int as n from personal_context where profile_id = $1`, [teenP])).rows[0].n)).toBe(0);
    expect(await h.as(teenGuardian, async (q) => (await q(`update personal_context set roles = '[]'::jsonb where profile_id = $1 returning profile_id`, [teenP])).rowCount)).toBe(0);
    const counts = await h.as(teenGuardian, async (q) => (await q(`select public.life_log_counts($1) as c`, [teenP])).rows[0].c);
    expect(counts).toMatchObject({ roles: 1, responsibilities: 1, dependents: 1, pressures: 1 });
    expect(JSON.stringify(counts)).not.toContain("مشروع");
    expect(await h.failsAs(other, `select public.life_log_counts($1)`, [teenP])).toMatch(/not allowed/);
  });
  it("teen يفعّل share_life_log_with_guardians ⇒ مربيه يقرأ (ولا يكتب)", async () => {
    await h.as(teen, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1, 'share_life_log_with_guardians', 'true'::jsonb, 'player')`, [teenP]));
    expect(await h.as(teenGuardian, async (q) => (await q(`select count(*)::int as n from personal_context where profile_id = $1`, [teenP])).rows[0].n)).toBe(1);
    expect(await h.as(teenGuardian, async (q) => (await q(`update personal_context set roles = '[]'::jsonb where profile_id = $1 returning profile_id`, [teenP])).rowCount)).toBe(0);
  });
  it("child: المربي صاحب manage_settings يقرأ ويعدّل، وما يكتبه يُسجَّل guardian_for_child", async () => {
    const r = await life.addLifeItem(creatorDb, { profileId: childP, actorId: creator.id, field: "responsibilities", text: "أرتب حقيبة المدرسة كل مساء", source: "guardian_for_child" });
    expect(r.ok).toBe(true);
    const row = await life.loadLife(creatorDb, childP);
    expect(row.log.responsibilities[0]).toMatchObject({ source: "guardian_for_child", text: "أرتب حقيبة المدرسة كل مساء" });
    expect(await h.as(other, async (q) => (await q(`select count(*)::int as n from personal_context where profile_id = $1`, [childP])).rows[0].n)).toBe(0);
  });
});
