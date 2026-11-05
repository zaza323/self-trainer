import { describe, it, expect } from "vitest";
import { resolveEffective, validateValue, clampValue, playerLayerApplies, type SettingRow } from "./resolve";
import { canWriteSetting } from "./permissions";
import { customization, SETTING_KEYS, catalogEntry } from "@/shared/config";
import { ALL_PERMISSIONS, NO_PERMISSIONS } from "@/shared/config/permissions";

const row = (p: Partial<SettingRow> & { key: string; value: unknown; set_by_role: SettingRow["set_by_role"] }): SettingRow => ({
  set_by_user_id: "u-" + p.set_by_role,
  locked: false,
  locked_by_user_id: null,
  ...p,
});

describe("resolveEffective — ترتيب الطبقات (4.11.1)", () => {
  it("يعود إلى الافتراضي حسب الوضع العمري عند غياب الصفوف", () => {
    for (const key of SETTING_KEYS) {
      for (const mode of ["child", "teen", "adult"] as const) {
        const r = resolveEffective({ key, ageMode: mode, rows: [] });
        expect(r.source).toBe("age_mode_default");
        expect(r.value).toEqual(catalogEntry(key)!.default[mode]);
        expect(r.locked).toBe(false);
        expect(r.setBy).toBeNull();
      }
    }
  });

  it("الافتراضي العام عندما لا وضع عمري (حساب مربٍ فقط)", () => {
    const r = resolveEffective({ key: "daily_mission_count", ageMode: null, rows: [] });
    expect(r.source).toBe("system_default");
  });

  it("إعداد المتدرب يغلب إعداد المربي في teen", () => {
    const rows = [
      row({ key: "daily_mission_count", value: 1, set_by_role: "player" }),
      row({ key: "daily_mission_count", value: 2, set_by_role: "guardian" }),
    ];
    const r = resolveEffective<number>({ key: "daily_mission_count", ageMode: "teen", rows });
    expect(r.value).toBe(1);
    expect(r.source).toBe("player");
    expect(r.setBy).toEqual({ userId: "u-player", role: "player" });
  });

  it("في child: طبقة المتدرب تُحتسب فقط للمفاتيح الشخصية", () => {
    const rows = [
      row({ key: "daily_mission_count", value: 1, set_by_role: "player" }),
      row({ key: "daily_mission_count", value: 2, set_by_role: "guardian" }),
      row({ key: "space_theme", value: "garden", set_by_role: "player" }),
    ];
    expect(playerLayerApplies("daily_mission_count", "child")).toBe(false);
    expect(playerLayerApplies("space_theme", "child")).toBe(true);
    const a = resolveEffective({ key: "daily_mission_count", ageMode: "child", rows });
    expect(a.value).toBe(2);
    expect(a.source).toBe("guardian");
    const b = resolveEffective({ key: "space_theme", ageMode: "child", rows });
    expect(b.value).toBe("garden");
    expect(b.source).toBe("player");
  });

  it("القفل يُلغي طبقة المتدرب ويُعلم الواجهة بمن قفل", () => {
    const rows = [
      row({ key: "space_theme", value: "garden", set_by_role: "player" }),
      row({ key: "space_theme", value: "room", set_by_role: "guardian", locked: true, locked_by_user_id: "u-creator" }),
    ];
    const r = resolveEffective({ key: "space_theme", ageMode: "child", rows });
    expect(r.value).toBe("room");
    expect(r.source).toBe("guardian");
    expect(r.locked).toBe(true);
    expect(r.lockedBy).toBe("u-creator");
  });

  it("تجاوز المهمة يُحتسب فقط للإعدادات التي تسمح به", () => {
    const allowed = resolveEffective({ key: "reflection_max_questions", ageMode: "adult", rows: [], missionOverride: 2 });
    expect(allowed.source).toBe("mission_override");
    expect(allowed.value).toBe(2);
    const denied = resolveEffective({ key: "daily_mission_count", ageMode: "adult", rows: [], missionOverride: 1 });
    expect(denied.source).toBe("age_mode_default");
  });

  it("القيم تُقص إلى حدود الكتالوج عند القراءة", () => {
    const rows = [row({ key: "daily_mission_count", value: 99, set_by_role: "guardian" })];
    const r = resolveEffective<number>({ key: "daily_mission_count", ageMode: "teen", rows });
    expect(r.value).toBe(catalogEntry("daily_mission_count")!.type === "int" ? (catalogEntry("daily_mission_count") as { max: number }).max : 0);
    expect(r.rawValue).toBe(99);
    const bad = resolveEffective({ key: "space_theme", ageMode: "teen", rows: [row({ key: "space_theme", value: "castle", set_by_role: "player" })] });
    expect(bad.value).toBe(catalogEntry("space_theme")!.default.teen);
  });

  it("مفتاح خارج الكتالوج يرمي خطأ (CUST-2)", () => {
    expect(() => resolveEffective({ key: "leaderboard_enabled", ageMode: "adult", rows: [] })).toThrow();
  });

  it("الحواجز غير موجودة في الكتالوج أصلًا (CUST-5)", () => {
    for (const g of customization.guardrails_not_configurable) expect(catalogEntry(g)).toBeUndefined();
    expect(SETTING_KEYS).not.toContain("leaderboards");
    expect(SETTING_KEYS).not.toContain("streak_threats");
  });
});

describe("validateValue — رفض القيم خارج الكتالوج", () => {
  it("int/int_or_null", () => {
    expect(validateValue("daily_mission_count", 2).ok).toBe(true);
    expect(validateValue("daily_mission_count", 0).ok).toBe(false);
    expect(validateValue("daily_mission_count", 1.5).ok).toBe(false);
    expect(validateValue("daily_mission_count", null).ok).toBe(false);
    expect(validateValue("game_intensity_override", null).ok).toBe(true);
    expect(validateValue("game_intensity_override", 100).ok).toBe(false);
  });
  it("enum / enum_or_null / bool", () => {
    expect(validateValue("companion_dialect", "mirror_user").ok).toBe(true);
    expect(validateValue("companion_dialect", "slang").ok).toBe(false);
    expect(validateValue("chat_auto_delete_days", 90).ok).toBe(true);
    expect(validateValue("chat_auto_delete_days", 45).ok).toBe(false);
    expect(validateValue("break_mode", "yes").ok).toBe(false);
  });
  it("capability_array", () => {
    expect(validateValue("focus_capabilities", ["attention", "planning"]).ok).toBe(true);
    expect(validateValue("focus_capabilities", ["attention", "attention"]).ok).toBe(false);
    expect(validateValue("focus_capabilities", ["charisma"]).ok).toBe(false);
    expect(validateValue("focus_capabilities", ["attention", "planning", "thinking", "autonomy"]).ok).toBe(false);
  });
  it("time types", () => {
    expect(validateValue("notification_time", "17:30").ok).toBe(true);
    expect(validateValue("notification_time", "25:00").ok).toBe(false);
    expect(validateValue("quiet_hours", ["22:00", "07:00"]).ok).toBe(true);
    expect(validateValue("quiet_hours", ["22:00"]).ok).toBe(false);
    expect(validateValue("available_windows", [{ from: "16:00", to: "18:00" }]).ok).toBe(true);
    expect(validateValue("available_windows", [{ from: "16:00" }]).ok).toBe(false);
  });
  it("مفتاح مجهول", () => {
    expect(validateValue("xp_store", true)).toEqual({ ok: false, reason: "key_not_in_catalog" });
  });
  it("clampValue يعيد الافتراضي للقيم التالفة", () => {
    const e = catalogEntry("quiet_hours")!;
    expect(clampValue(e, "junk", e.default.adult)).toEqual(e.default.adult);
  });
});

describe("canWriteSetting — من يعدّل ماذا (4.11.2)", () => {
  const player = { role: "player" as const, userId: "p1" };
  const creator = { role: "guardian" as const, userId: "g1", permissions: ALL_PERMISSIONS, isCreator: true, isAccountOwner: true };
  const otherGuardianNoPerm = { role: "guardian" as const, userId: "g2", permissions: NO_PERMISSIONS, isCreator: false, isAccountOwner: false };
  const otherGuardianWithPerm = { ...otherGuardianNoPerm, permissions: { ...NO_PERMISSIONS, manage_settings: true } };

  it("child: المتدرب يعدّل الإعدادات الشخصية فقط", () => {
    expect(canWriteSetting({ key: "space_theme", ageMode: "child", actor: player, rows: [] }).allowed).toBe(true);
    expect(canWriteSetting({ key: "daily_mission_count", ageMode: "child", actor: player, rows: [] }).allowed).toBe(false);
  });
  it("teen/adult: المتدرب يعدّل كل إعداداته", () => {
    expect(canWriteSetting({ key: "daily_mission_count", ageMode: "teen", actor: player, rows: [] }).allowed).toBe(true);
    expect(canWriteSetting({ key: "daily_mission_count", ageMode: "adult", actor: player, rows: [] }).allowed).toBe(true);
  });
  it("المربي يحتاج manage_settings إلا إذا كان صاحب الحساب", () => {
    expect(canWriteSetting({ key: "daily_mission_count", ageMode: "child", actor: creator, rows: [] }).allowed).toBe(true);
    expect(canWriteSetting({ key: "daily_mission_count", ageMode: "child", actor: otherGuardianNoPerm, rows: [] })).toEqual({
      allowed: false, reason: "missing_permission_manage_settings",
    });
    expect(canWriteSetting({ key: "daily_mission_count", ageMode: "teen", actor: otherGuardianWithPerm, rows: [] }).allowed).toBe(true);
  });
  it("القفل: child أي إعداد؛ teen إعدادات الأمان فقط؛ adult لا قفل", () => {
    expect(canWriteSetting({ key: "space_theme", ageMode: "child", actor: creator, rows: [], lock: true }).allowed).toBe(true);
    expect(canWriteSetting({ key: "daily_mission_count", ageMode: "teen", actor: otherGuardianWithPerm, rows: [], lock: true }).allowed).toBe(false);
    expect(canWriteSetting({ key: "companion_free_chat_daily_minutes", ageMode: "teen", actor: otherGuardianWithPerm, rows: [], lock: true }).allowed).toBe(true);
    expect(canWriteSetting({ key: "companion_free_chat_daily_minutes", ageMode: "adult", actor: otherGuardianWithPerm, rows: [], lock: true }).allowed).toBe(false);
  });
  it("الإعداد المقفل لا يعدّله المتدرب، والمنشئ يقفل ضد بقية المربين", () => {
    const rows = [row({ key: "space_theme", value: "room", set_by_role: "guardian", locked: true, locked_by_user_id: "g1" })];
    expect(canWriteSetting({ key: "space_theme", ageMode: "child", actor: player, rows })).toEqual({ allowed: false, reason: "locked_by_guardian" });
    expect(canWriteSetting({ key: "space_theme", ageMode: "child", actor: otherGuardianWithPerm, rows, creatorUserIds: ["g1"] })).toEqual({
      allowed: false, reason: "locked_by_creator",
    });
    expect(canWriteSetting({ key: "space_theme", ageMode: "child", actor: creator, rows, creatorUserIds: ["g1"] }).allowed).toBe(true);
  });
  it("المتدرب لا يقفل أبدًا", () => {
    expect(canWriteSetting({ key: "space_theme", ageMode: "teen", actor: player, rows: [], lock: true }).allowed).toBe(false);
  });
});
