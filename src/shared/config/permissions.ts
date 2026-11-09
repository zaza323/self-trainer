/** صلاحيات رابط المربي (ACC-8 + ب.12 view_planner في 0.4 + set_task_margin في 0.5 ب.2). الترتيب ثابت لأنه يُعرض في الواجهة وفي سجل التدقيق؛ يطابق customization.permissions_all (اختبار). */
export const GUARDIAN_PERMISSIONS = [
  "view_progress",
  "view_chat",
  "intervene_chat",
  "add_missions",
  "receive_alerts",
  "manage_guardians",
  "add_rewards",
  "manage_settings",
  "approve_suggestions",
  "view_planner",
  "set_task_margin",
] as const;
export type GuardianPermission = (typeof GUARDIAN_PERMISSIONS)[number];
export type PermissionSet = Record<GuardianPermission, boolean>;

export const GUARDIAN_RELATIONS = ["mother", "father", "teacher", "coach", "mentor", "partner", "other"] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

/** الافتراضي لمربي البالغ (ACC-10): `view_progress` فقط. يُستخدم أيضًا عند انتقال teen → adult (القسم 13). */
export const VIEW_PROGRESS_ONLY: PermissionSet = Object.fromEntries(
  GUARDIAN_PERMISSIONS.map((p) => [p, p === "view_progress"]),
) as PermissionSet;

/** صاحب الحساب يملكها كلها (ACC-8). المربي المنشئ في child يأخذها كلها. */
export const ALL_PERMISSIONS: PermissionSet = Object.fromEntries(
  GUARDIAN_PERMISSIONS.map((p) => [p, true]),
) as PermissionSet;

export const NO_PERMISSIONS: PermissionSet = Object.fromEntries(
  GUARDIAN_PERMISSIONS.map((p) => [p, false]),
) as PermissionSet;

export function normalizePermissions(input: Partial<Record<string, unknown>> | null | undefined): PermissionSet {
  const out = { ...NO_PERMISSIONS };
  if (!input) return out;
  for (const p of GUARDIAN_PERMISSIONS) out[p] = input[p] === true;
  return out;
}
