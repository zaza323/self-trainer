/**
 * 0.4 الجزء (أ) على قاعدة بيانات حقيقية: أنواع الكتالوج الجديدة تُتحقق في المشغّل، allowed_age_modes، أعمدة أشكال الرد،
 * ai_calls.meta، وأن الكتالوج المتزامن يحمل المفاتيح الجديدة بحدودها.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { customization } from "../../src/shared/config";

const h = new RlsHarness();
let teen: TestUser, adult: TestUser;
let teenProfile: string, adultProfile: string;
const put = (u: TestUser, profile: string, key: string, value: unknown) =>
  h.failsAs(u, `insert into settings (profile_id, key, value, set_by_role) values ($1,$2,$3::jsonb,'player') on conflict (profile_id, key, set_by_role) do update set value = excluded.value`, [profile, key, JSON.stringify(value)]);

beforeAll(async () => {
  await h.setup();
  teen = await h.createUser("t04@test.local");
  adult = await h.createUser("a04@test.local");
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','م','teen') returning id`, [teen.id])).rows[0].id);
  adultProfile = await h.as(adult, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','ب','adult') returning id`, [adult.id])).rows[0].id);
});
afterAll(() => h.teardown());

describe("الكتالوج المتزامن", () => {
  it("كل مفاتيح config/customization.json موجودة في settings_catalog بأنواعها", async () => {
    const rows = await h.service<{ key: string; type: string }>(`select key, type from settings_catalog`);
    const byKey = Object.fromEntries(rows.rows.map((r) => [r.key, r.type]));
    for (const [k, e] of Object.entries(customization.catalog)) expect(byKey[k], k).toBe(e.type);
    expect(byKey.companion_prefer_choices).toBe("bool");
  });
});

describe("المشغّل يتحقق من الأنواع الجديدة (CUST-2)", () => {
  it("int_or_auto", async () => {
    expect(await put(teen, teenProfile, "notification_max_per_day", "auto")).toBeNull();
    expect(await put(teen, teenProfile, "notification_max_per_day", 2)).toBeNull();
    expect(await put(teen, teenProfile, "notification_max_per_day", "many")).toMatch(/number or auto/);
    expect(await put(teen, teenProfile, "notification_max_per_day", 999)).toMatch(/out of range/);
  });
  it("time_local_or_null / enum_array", async () => {
    expect(await put(teen, teenProfile, "target_bedtime", null)).toBeNull();
    expect(await put(teen, teenProfile, "target_bedtime", "22:30")).toBeNull();
    expect(await put(teen, teenProfile, "target_bedtime", "10pm")).toMatch(/HH:MM/);
    expect(await put(teen, teenProfile, "rest_activities_enabled", ["nap", "walk"])).toBeNull();
    expect(await put(teen, teenProfile, "rest_activities_enabled", ["nap", "nap"])).toMatch(/duplicates/);
    expect(await put(teen, teenProfile, "rest_activities_enabled", ["tv"])).toMatch(/not allowed/);
    expect(await put(teen, teenProfile, "rest_activities_enabled", "nap")).toMatch(/array/);
  });
  it("moment_windows / list / category_list", async () => {
    expect(await put(teen, teenProfile, "moment_windows", { morning_plan: ["05:00", "11:00"] })).toBeNull();
    expect(await put(teen, teenProfile, "moment_windows", { morning_plan: ["05:00"] })).toMatch(/pairs/);
    expect(await put(teen, teenProfile, "custom_rest_activities", [{ title: "تأمل", default_min: 10 }])).toBeNull();
    expect(await put(teen, teenProfile, "custom_rest_activities", [{ title: "", default_min: 10 }])).toMatch(/spec/);
    expect(await put(teen, teenProfile, "custom_rest_activities", [{ title: "ا", default_min: 0 }])).toMatch(/spec/);
    expect(await put(teen, teenProfile, "custom_rest_activities", Array.from({ length: 11 }, () => ({ title: "ا", default_min: 5 })))).toMatch(/max items/);
    expect(await put(teen, teenProfile, "reconstruction_categories", ["sleep", "unknown"])).toBeNull();
    expect(await put(teen, teenProfile, "reconstruction_categories", ["sleep"])).toMatch(/unknown/);
    expect(await put(teen, teenProfile, "reconstruction_categories", ["sleep", "sleep", "unknown"])).toMatch(/duplicates/);
  });
  it("allowed_age_modes: overdue_auto_reschedule للبالغ فقط", async () => {
    expect(await put(teen, teenProfile, "overdue_auto_reschedule", true)).toMatch(/not available for this age mode/);
    expect(await put(adult, adultProfile, "overdue_auto_reschedule", true)).toBeNull();
    expect(await put(teen, teenProfile, "companion_prefer_choices", true)).toBeNull();
  });
});

describe("أعمدة أشكال الرد وميزانية الكتابة (أ.7)", () => {
  it("companion_messages تحمل moment/response_mode/options/chosen_option_id/input_method مع قيود", async () => {
    const sess = (await h.service<{ id: string }>(`insert into companion_sessions (profile_id, mode, free_text_budget) values ($1,'reflect',2) returning id`, [teenProfile])).rows[0]!.id;
    await h.service(`insert into companion_messages (session_id, role, content, moment, response_mode, options) values ($1,'ai','س','reflection_secondary','choices_plus_other','[{"id":"o1","label":"تشتت","source":"ai"}]')`, [sess]);
    await h.service(`insert into companion_messages (session_id, role, content, input_method, chosen_option_id) values ($1,'player','تشتت','option','o1')`, [sess]);
    await expect(h.service(`insert into companion_messages (session_id, role, content, response_mode) values ($1,'ai','x','dropdown')`, [sess])).rejects.toThrow(/check/);
    await expect(h.service(`insert into companion_messages (session_id, role, content, input_method) values ($1,'player','x','telepathy')`, [sess])).rejects.toThrow(/check/);
    const s = await h.service<{ free_text_budget: number; free_text_used: number }>(`select free_text_budget, free_text_used from companion_sessions where id = $1`, [sess]);
    expect(s.rows[0]).toEqual({ free_text_budget: 2, free_text_used: 0 });
  });
  it("ai_calls.meta يحفظ استبدال الشكل", async () => {
    await h.service(`insert into ai_calls (profile_id, function, prompt_version, model_id, input_hash, valid, attempt, meta) values ($1,'goal_builder','v','m','h',true,1,'{"final_mode":"free_text","reasons":["model_mode_overridden"]}')`, [teenProfile]);
    const r = await h.service<{ meta: { reasons: string[] } }>(`select meta from ai_calls where profile_id = $1`, [teenProfile]);
    expect(r.rows[0]!.meta.reasons).toContain("model_mode_overridden");
  });
});
