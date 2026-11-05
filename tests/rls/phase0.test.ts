/**
 * اختبارات RLS للمرحلة 0 — معيار القبول: "اختبارات RLS ودالة effective تمر".
 * تعمل على PostgreSQL محلي مع محاكاة auth (tests/rls/auth-shim.sql).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { ALL_PERMISSIONS, NO_PERMISSIONS, VIEW_PROGRESS_ONLY } from "../../src/shared/config/permissions";
import { customization } from "../../src/shared/config";

const h = new RlsHarness();
let creator: TestUser, guardian2: TestUser, teen: TestUser, adult: TestUser, stranger: TestUser, admin: TestUser, childUser: TestUser;
let teenProfile: string, adultProfile: string, childProfile: string;

beforeAll(async () => {
  await h.setup();
  creator = await h.createUser("creator@test.local");
  guardian2 = await h.createUser("g2@test.local");
  teen = await h.createUser("teen@test.local");
  adult = await h.createUser("adult@test.local");
  stranger = await h.createUser("stranger@test.local");
  admin = await h.createUser("admin@test.local", true);
  childUser = await h.createUser("child-abc@child.local");

  // كل مستخدم ينشئ ملفه بنفسه عبر RLS (teen/adult/guardian)
  teenProfile = await h.as(teen, async (q) =>
    (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','مراهقة','teen') returning id`, [teen.id])).rows[0].id);
  adultProfile = await h.as(adult, async (q) =>
    (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','بالغ','adult') returning id`, [adult.id])).rows[0].id);
  await h.as(creator, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','أم')`, [creator.id]));
  await h.as(guardian2, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','معلم')`, [guardian2.id]));
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));

  // الطفل يُنشأ من الخادم (service role) عبر الدالة المخصصة (ACC-3)
  const r = await h.service<{ id: string }>(
    `select app.create_child_profile($1,$2,'طفل','abc','mother','2026-11-05.1') as id`, [childUser.id, creator.id]);
  childProfile = r.rows[0]!.id;
});
afterAll(() => h.teardown());

describe("profiles", () => {
  it("لا يُنشأ ملف child من المتصفح (ACC-3)", async () => {
    const u = await h.createUser("x@test.local");
    const err = await h.failsAs(u, `insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','x','child')`, [u.id]);
    expect(err).toMatch(/row-level security|violates/);
  });
  it("لا يُنشأ ملف لمستخدم آخر", async () => {
    const err = await h.failsAs(stranger, `insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','x','adult')`, [teen.id]);
    expect(err).toMatch(/row-level security/);
  });
  it("المربي المنشئ يرى الطفل، والغريب لا يراه", async () => {
    const seen = await h.as(creator, async (q) => (await q(`select id from profiles where id = $1`, [childProfile])).rowCount);
    expect(seen).toBe(1);
    const notSeen = await h.as(stranger, async (q) => (await q(`select id from profiles where id = $1`, [childProfile])).rowCount);
    expect(notSeen).toBe(0);
  });
  it("المراهق يرى ملفه فقط", async () => {
    const rows = await h.as(teen, async (q) => (await q(`select id from profiles`)).rows.map((r) => r.id));
    expect(rows).toEqual([teenProfile]);
  });
  it("المشرف يرى كل الملفات", async () => {
    const n = await h.as(admin, async (q) => (await q(`select count(*)::int as n from profiles`)).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(5);
  });
  it("الطفل لا يحذف حسابه ولا يعدّل ملفه؛ المنشئ يعدّله", async () => {
    const del = await h.as(childUser, async (q) => (await q(`delete from profiles where id = $1`, [childProfile])).rowCount);
    expect(del).toBe(0);
    const upd = await h.as(childUser, async (q) => (await q(`update profiles set display_name = 'x' where id = $1`, [childProfile])).rowCount);
    expect(upd).toBe(0);
    const ok = await h.as(creator, async (q) => (await q(`update profiles set display_name = 'طفلي' where id = $1`, [childProfile])).rowCount);
    expect(ok).toBe(1);
  });
  it("حساب المربي فقط بلا وضع عمري (قيد)", async () => {
    const err = await h.failsAs(guardian2, `update profiles set age_mode = 'adult' where user_id = $1`, [guardian2.id]);
    expect(err).toMatch(/guardian_has_no_age_mode/);
  });
});

describe("guardian_links & invites", () => {
  it("رابط المنشئ نشط بكل الصلاحيات", async () => {
    const link = await h.as(creator, async (q) => (await q(`select * from guardian_links where player_id = $1`, [childProfile])).rows[0]);
    expect(link.is_creator).toBe(true);
    expect(link.permissions).toEqual(ALL_PERMISSIONS);
  });
  it("الغريب لا ينشئ دعوة لطفل ليس مربيه", async () => {
    const err = await h.failsAs(stranger, `insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'teacher','{}')`, [childProfile, stranger.id]);
    expect(err).toMatch(/row-level security/);
  });
  it("المنشئ يدعو مربيًا ثانيًا ويقبل بالرمز (ACC-7)", async () => {
    const code = await h.as(creator, async (q) =>
      (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'teacher',$3) returning code`,
        [childProfile, creator.id, { ...NO_PERMISSIONS, view_progress: true, manage_settings: true }])).rows[0].code);
    const linkId = await h.as(guardian2, async (q) => (await q(`select app.accept_guardian_invite($1) as id`, [code])).rows[0].id);
    expect(linkId).toBeTruthy();
    const again = await h.failsAs(guardian2, `select app.accept_guardian_invite($1)`, [code]);
    expect(again).toMatch(/invalid or expired/);
    const links = await h.as(guardian2, async (q) => (await q(`select guardian_id from guardian_links where player_id = $1 order by created_at`, [childProfile])).rows);
    expect(links.map((l) => l.guardian_id)).toEqual([creator.id, guardian2.id]); // المربون يرون بعضهم
  });
  it("المتدرب لا يكون مربيًا لنفسه", async () => {
    const code = await h.as(adult, async (q) =>
      (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'partner','{}') returning code`, [adultProfile, adult.id])).rows[0].code);
    const err = await h.failsAs(adult, `select app.accept_guardian_invite($1)`, [code]);
    expect(err).toMatch(/own guardian/);
  });
  it("ACC-9: لا تُزال صلاحية receive_alerts من آخر مربٍ يملكها في child", async () => {
    const err = await h.failsAs(creator, `update guardian_links set permissions = permissions || '{"receive_alerts": false}' where player_id = $1 and guardian_id = $2`, [childProfile, creator.id]);
    expect(err).toMatch(/receive_alerts/);
    // بعد منح الثاني receive_alerts يصبح ممكنًا
    await h.as(creator, (q) => q(`update guardian_links set permissions = permissions || '{"receive_alerts": true}' where player_id = $1 and guardian_id = $2`, [childProfile, guardian2.id]));
    const ok = await h.as(creator, async (q) => (await q(`update guardian_links set permissions = permissions || '{"receive_alerts": false}' where player_id = $1 and guardian_id = $2`, [childProfile, creator.id])).rowCount);
    expect(ok).toBe(1);
    await h.as(creator, (q) => q(`update guardian_links set permissions = permissions || '{"receive_alerts": true}' where player_id = $1 and guardian_id = $2`, [childProfile, creator.id]));
  });
  it("المربي بلا manage_guardians لا يعدّل الروابط؛ رابط المنشئ لا يُزال", async () => {
    const n = await h.as(guardian2, async (q) => (await q(`update guardian_links set status = 'removed' where player_id = $1 and guardian_id = $2`, [childProfile, creator.id])).rowCount);
    expect(n).toBe(0);
    const err = await h.failsAs(creator, `update guardian_links set status = 'removed' where player_id = $1 and guardian_id = $2`, [childProfile, creator.id]);
    expect(err).toMatch(/creator guardian link cannot be removed/);
  });
});

describe("settings — الطبقات والصلاحيات في RLS", () => {
  it("المراهق يكتب إعداده؛ القيم خارج الحدود والمفاتيح خارج الكتالوج تُرفض (CUST-2)", async () => {
    await h.as(teen, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'daily_mission_count','1','player')`, [teenProfile]));
    expect(await h.failsAs(teen, `insert into settings (profile_id, key, value, set_by_role) values ($1,'reflection_max_questions','7','player')`, [teenProfile])).toMatch(/out of range/);
    expect(await h.failsAs(teen, `insert into settings (profile_id, key, value, set_by_role) values ($1,'leaderboards','true','player')`, [teenProfile])).toMatch(/foreign key|row-level security|not in catalog/);
    expect(await h.failsAs(teen, `insert into settings (profile_id, key, value, set_by_role) values ($1,'focus_capabilities','["attention","charisma"]','player')`, [teenProfile])).toMatch(/unknown capability/);
    expect(await h.failsAs(teen, `insert into settings (profile_id, key, value, set_by_role) values ($1,'notification_time','"9pm"','player')`, [teenProfile])).toMatch(/HH:MM/);
  });
  it("الطفل يعدّل الإعدادات الشخصية فقط (4.11.2)", async () => {
    expect(await h.failsAs(childUser, `insert into settings (profile_id, key, value, set_by_role) values ($1,'daily_mission_count','1','player')`, [childProfile])).toMatch(/row-level security/);
    await h.as(childUser, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'space_theme','"garden"','player')`, [childProfile]));
    expect(await h.failsAs(childUser, `insert into settings (profile_id, key, value, set_by_role, locked) values ($1,'break_mode','true','player',true)`, [childProfile])).toMatch(/row-level security|lock_only_by_guardian/);
  });
  it("المنشئ يكتب ويقفل؛ القفل يمنع الطفل (CUST-4)", async () => {
    await h.as(creator, (q) => q(`insert into settings (profile_id, key, value, set_by_role, locked) values ($1,'space_theme','"room"','guardian',true)`, [childProfile]));
    const n = await h.as(childUser, async (q) => (await q(`update settings set value = '"observatory"' where profile_id = $1 and key = 'space_theme' and set_by_role = 'player'`, [childProfile])).rowCount);
    expect(n).toBe(0);
    const eff = await h.service<{ v: unknown }>(`select app.setting_effective($1,'space_theme') as v`, [childProfile]);
    expect(eff.rows[0]!.v).toBe("room");
  });
  it("المنشئ يقفل ضد بقية المربين؛ المربي الثاني (manage_settings) يكتب المفاتيح غير المقفلة", async () => {
    const n = await h.as(guardian2, async (q) => (await q(`update settings set value = '"garden"' where profile_id = $1 and key = 'space_theme' and set_by_role = 'guardian'`, [childProfile])).rowCount);
    expect(n).toBe(0);
    await h.as(guardian2, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'daily_mission_count','1','guardian')`, [childProfile]));
    const eff = await h.service<{ v: unknown }>(`select app.setting_effective($1,'daily_mission_count') as v`, [childProfile]);
    expect(eff.rows[0]!.v).toBe(1);
  });
  it("مربٍ بلا manage_settings لا يكتب (CUST-3)", async () => {
    // الغريب ليس مربيًا أصلًا
    expect(await h.failsAs(stranger, `insert into settings (profile_id, key, value, set_by_role) values ($1,'daily_mission_count','1','guardian')`, [childProfile])).toMatch(/row-level security/);
    // مربي البالغ بـ view_progress فقط
    const code = await h.as(adult, async (q) =>
      (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'coach',$3) returning code`, [adultProfile, adult.id, VIEW_PROGRESS_ONLY])).rows[0].code);
    await h.as(guardian2, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
    expect(await h.failsAs(guardian2, `insert into settings (profile_id, key, value, set_by_role) values ($1,'daily_mission_count','1','guardian')`, [adultProfile])).toMatch(/row-level security/);
    // لا قفل في adult حتى مع manage_settings
    await h.as(adult, (q) => q(`update guardian_links set permissions = $2 where player_id = $1 and guardian_id = $3`, [adultProfile, { ...VIEW_PROGRESS_ONLY, manage_settings: true }, guardian2.id]));
    expect(await h.failsAs(guardian2, `insert into settings (profile_id, key, value, set_by_role, locked) values ($1,'daily_mission_count','1','guardian',true)`, [adultProfile])).toMatch(/row-level security/);
    await h.as(guardian2, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'daily_mission_count','2','guardian')`, [adultProfile]));
  });
  it("teen: المربي يقفل إعدادات الأمان فقط (القرار المفتوح 9)", async () => {
    const code = await h.as(teen, async (q) =>
      (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'father',$3) returning code`, [teenProfile, teen.id, { ...NO_PERMISSIONS, view_progress: true, manage_settings: true }])).rows[0].code);
    await h.as(guardian2, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
    expect(await h.failsAs(guardian2, `insert into settings (profile_id, key, value, set_by_role, locked) values ($1,'daily_mission_count','2','guardian',true)`, [teenProfile])).toMatch(/row-level security/);
    await h.as(guardian2, (q) => q(`insert into settings (profile_id, key, value, set_by_role, locked) values ($1,'companion_free_chat_daily_minutes','20','guardian',true)`, [teenProfile]));
    const n = await h.as(teen, async (q) => (await q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'companion_free_chat_daily_minutes','60','player') on conflict do nothing`, [teenProfile])).rowCount).catch(() => -1);
    expect(n).toBeLessThanOrEqual(0);
  });
  it("الإعداد الفعّال من قاعدة البيانات يطابق الترتيب: المتدرب يغلب المربي في teen", async () => {
    await h.as(guardian2, (q) => q(`insert into settings (profile_id, key, value, set_by_role) values ($1,'daily_mission_count','3','guardian')`, [teenProfile]));
    const eff = await h.service<{ v: unknown }>(`select app.setting_effective($1,'daily_mission_count') as v`, [teenProfile]);
    expect(eff.rows[0]!.v).toBe(1);
    const def = await h.service<{ v: unknown }>(`select app.setting_effective($1,'reflection_max_questions') as v`, [teenProfile]);
    expect(def.rows[0]!.v).toBe(customization.catalog.reflection_max_questions!.default.teen);
  });
  it("سجل التدقيق يُكتب تلقائيًا وإشعار صاحب الحساب بتغيير المربي (CUST-6)", async () => {
    const audit = await h.service<{ n: number }>(`select count(*)::int as n from settings_audit where profile_id = $1 and key = 'space_theme'`, [childProfile]);
    expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(2);
    const notif = await h.service<{ n: number }>(`select count(*)::int as n from notifications where profile_id = $1 and type = 'settings_changed_by_guardian'`, [childProfile]);
    expect(notif.rows[0]!.n).toBeGreaterThanOrEqual(1);
    const visible = await h.as(stranger, async (q) => (await q(`select count(*)::int as n from settings_audit`)).rows[0].n);
    expect(visible).toBe(0);
    const mine = await h.as(teen, async (q) => (await q(`select count(*)::int as n from settings_audit where profile_id = $1`, [teenProfile])).rows[0].n);
    expect(mine).toBeGreaterThan(0);
  });
  it("الغريب لا يقرأ إعدادات غيره", async () => {
    const n = await h.as(stranger, async (q) => (await q(`select count(*)::int as n from settings where profile_id <> (select id from profiles where user_id = $1)`, [stranger.id])).rows[0].n);
    expect(n).toBe(0);
  });
});

describe("الانتقال بين الأوضاع (القسم 13)", () => {
  it("teen → adult: المتدرب فقط؛ صلاحيات المربين تعود إلى view_progress", async () => {
    expect(await h.failsAs(guardian2, `select app.transition_age_mode($1,'adult')`, [teenProfile])).toMatch(/only the player/);
    await h.as(teen, (q) => q(`select app.transition_age_mode($1,'adult')`, [teenProfile]));
    const link = await h.service<{ permissions: unknown }>(`select permissions from guardian_links where player_id = $1 and guardian_id = $2`, [teenProfile, guardian2.id]);
    expect(link.rows[0]!.permissions).toEqual(VIEW_PROGRESS_ONLY);
    const mode = await h.service<{ age_mode: string }>(`select age_mode from profiles where id = $1`, [teenProfile]);
    expect(mode.rows[0]!.age_mode).toBe("adult");
    const log = await h.service<{ n: number }>(`select count(*)::int as n from audit_log where action = 'age_mode_transition' and target = $1`, [teenProfile]);
    expect(log.rows[0]!.n).toBe(1);
  });
  it("child → teen: المنشئ فقط؛ الأقفال تُرفع عدا إعدادات الأمان؛ المربون يبقون", async () => {
    await h.as(creator, (q) => q(`insert into settings (profile_id, key, value, set_by_role, locked) values ($1,'companion_free_chat_daily_minutes','10','guardian',true)`, [childProfile]));
    expect(await h.failsAs(guardian2, `select app.transition_age_mode($1,'teen')`, [childProfile])).toMatch(/creator guardian/);
    expect(await h.failsAs(childUser, `select app.transition_age_mode($1,'teen')`, [childProfile])).toMatch(/creator guardian/);
    await h.as(creator, (q) => q(`select app.transition_age_mode($1,'teen')`, [childProfile]));
    const locks = await h.service<{ key: string; locked: boolean }>(`select key, locked from settings where profile_id = $1 and set_by_role = 'guardian' order by key`, [childProfile]);
    const byKey = Object.fromEntries(locks.rows.map((r) => [r.key, r.locked]));
    expect(byKey.space_theme).toBe(false);
    expect(byKey.companion_free_chat_daily_minutes).toBe(true);
    const links = await h.service<{ n: number }>(`select count(*)::int as n from guardian_links where player_id = $1 and status = 'active'`, [childProfile]);
    expect(links.rows[0]!.n).toBe(2);
    const audit = await h.service<{ n: number }>(`select count(*)::int as n from settings_audit where profile_id = $1 and source = 'age_transition'`, [childProfile]);
    expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });
  it("لا انتقال إلى child", async () => {
    expect(await h.failsAs(adult, `select app.transition_age_mode($1,'child')`, [adultProfile])).toMatch(/cannot transition into child/);
  });
});

describe("audit_log / consents", () => {
  it("سجل التدقيق العام للمشرف فقط", async () => {
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from audit_log`)).rows[0].n)).toBe(0);
    expect(await h.as(admin, async (q) => (await q(`select count(*)::int as n from audit_log`)).rows[0].n)).toBeGreaterThan(0);
  });
  it("الموافقة مسجلة بالإصدار والمربي (8.2)", async () => {
    const c = await h.as(creator, async (q) => (await q(`select policy_version from consents where profile_id = $1`, [childProfile])).rows);
    expect(c).toEqual([{ policy_version: "2026-11-05.1" }]);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from consents`)).rows[0].n)).toBe(0);
  });
});
