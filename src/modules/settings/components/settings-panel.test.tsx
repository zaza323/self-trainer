/**
 * يتحقق أن شاشة الإعدادات (CUST-7) تُصيّر كل أنواع الكتالوج في الخادم دون أخطاء،
 * وتعرض القيمة الفعّالة ومن ضبطها وحالة القفل لكل إعداد.
 */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { SettingsPanel, type SettingView } from "./settings-panel";
import { SETTING_KEYS, catalogEntry, customization } from "@/shared/config";
import { resolveEffective } from "../resolve";
import { canWriteSetting } from "../permissions";
import labels from "@content/settings_labels.ar.json";

function views(role: "player" | "guardian"): SettingView[] {
  const L = labels as unknown as Record<string, { label: string; help: string }> & { enum_values: Record<string, Record<string, string>> };
  const rows = [
    { key: "space_theme", value: "garden", set_by_role: "guardian" as const, set_by_user_id: "g1", locked: true, locked_by_user_id: "g1" },
    { key: "daily_mission_count", value: 1, set_by_role: "player" as const, set_by_user_id: "p1", locked: false, locked_by_user_id: null },
  ];
  const actor = role === "player"
    ? { role: "player" as const, userId: "p1" }
    : { role: "guardian" as const, userId: "g1", permissions: { view_progress: true, view_chat: true, intervene_chat: true, add_missions: true, receive_alerts: true, manage_guardians: true, add_rewards: true, manage_settings: true, approve_suggestions: true, view_planner: true }, isCreator: true, isAccountOwner: true };
  return SETTING_KEYS.map((key) => {
    const effective = resolveEffective({ key, ageMode: "child", rows });
    const common = { key, ageMode: "child" as const, actor, rows, creatorUserIds: ["g1"] };
    return {
      key, entry: catalogEntry(key)!, label: L[key]?.label ?? key, help: L[key]?.help ?? "", enumLabels: L.enum_values[key] ?? {},
      effective, myRow: rows.find((r) => r.key === key && r.set_by_role === role) ?? null,
      canEdit: canWriteSetting(common), canLock: canWriteSetting({ ...common, lock: true }), whoSet: effective.source,
    };
  });
}

const base = { profileId: "00000000-0000-0000-0000-000000000001", ageMode: "child" as const, guardrails: customization.guardrails_not_configurable, guardrailsIntro: "x", capabilityNames: { attention: "الانتباه" }, lockedHint: "مقفل" };

describe("SettingsPanel", () => {
  it("يصيّر كل مفاتيح الكتالوج للمتدرب مع حالة القفل", () => {
    const html = renderToString(<SettingsPanel {...base} role="player" items={views("player")} />);
    for (const key of SETTING_KEYS) expect(html).toContain((labels as unknown as Record<string, { label: string }>)[key]!.label);
    expect(html).toContain("مقفل");                 // space_theme مقفل من المربي
    expect(html).toContain("لا تستطيع تعديل");     // daily_mission_count غير قابل للتعديل من الطفل
    expect(html).toContain("leaderboards");         // الحواجز معروضة
  });
  it("يصيّر نماذج التعديل والقفل للمربي المنشئ", () => {
    const html = renderToString(<SettingsPanel {...base} role="guardian" items={views("guardian")} />);
    expect(html).toContain('name="lock"');
    expect(html).toContain("فك القفل");
    expect((html.match(/name="value"/g) ?? []).length).toBeGreaterThanOrEqual(SETTING_KEYS.length);
  });
});
