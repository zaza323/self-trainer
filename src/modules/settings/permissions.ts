/**
 * من يعدّل ماذا (4.11.2) — مرآة TypeScript لدالة app.settings_can_write في قاعدة البيانات.
 * الواجهة تستخدمها لإظهار/إخفاء أدوات التعديل؛ الإنفاذ الحقيقي في RLS.
 */
import { customization, catalogEntry, type AgeMode } from "@/shared/config";
import type { PermissionSet } from "@/shared/config/permissions";
import type { SettingRow } from "./resolve";

export type SettingsActor =
  | { role: "player"; userId: string }
  | { role: "guardian"; userId: string; permissions: PermissionSet; isCreator: boolean; isAccountOwner: boolean };

export type EditDecision = { allowed: true } | { allowed: false; reason: string };

export function canWriteSetting(args: {
  key: string;
  ageMode: AgeMode | null;
  actor: SettingsActor;
  rows: SettingRow[];
  lock?: boolean;
  /** معرّفات مستخدمي المربين المنشئين (لتطبيق قفل المنشئ ضد البقية) */
  creatorUserIds?: string[];
}): EditDecision {
  const { key, ageMode, actor, rows, lock = false, creatorUserIds = [] } = args;
  const entry = catalogEntry(key);
  if (!entry) return { allowed: false, reason: "key_not_in_catalog" };
  if (!ageMode) return { allowed: false, reason: "profile_is_not_player" };
  const rules = customization.edit_rules[ageMode];
  const mine = rows.filter((r) => r.key === key);

  if (actor.role === "player") {
    if (lock) return { allowed: false, reason: "player_cannot_lock" };
    if (rules.player === "player_editable_keys_only" && !customization.player_editable_in_child.includes(key)) {
      return { allowed: false, reason: "not_player_editable_in_this_mode" };
    }
    if (mine.some((r) => r.locked)) return { allowed: false, reason: "locked_by_guardian" };
    return { allowed: true };
  }

  // guardian
  if (!actor.isAccountOwner && !actor.permissions.manage_settings) {
    return { allowed: false, reason: "missing_permission_manage_settings" };
  }
  const guardianRow = mine.find((r) => r.set_by_role === "guardian");
  if (
    guardianRow?.locked &&
    guardianRow.locked_by_user_id &&
    guardianRow.locked_by_user_id !== actor.userId &&
    rules.creator_can_lock_against_guardians &&
    creatorUserIds.includes(guardianRow.locked_by_user_id)
  ) {
    return { allowed: false, reason: "locked_by_creator" };
  }
  if (lock) {
    if (rules.guardian_can_lock) return { allowed: true };
    if (rules.lockable_keys_override?.includes(key)) return { allowed: true };
    return { allowed: false, reason: "lock_not_allowed_in_this_mode" };
  }
  return { allowed: true };
}

/** هل يُقفل هذا المفتاح أصلًا في هذا الوضع؟ (لعرض زر القفل) */
export function isLockableKey(key: string, ageMode: AgeMode): boolean {
  const rules = customization.edit_rules[ageMode];
  return rules.guardian_can_lock || (rules.lockable_keys_override?.includes(key) ?? false);
}
