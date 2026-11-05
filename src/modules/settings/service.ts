/**
 * settings.effective(profileId, key) — نقطة القراءة الوحيدة المسموح بها لأي إعداد (CUST-1).
 * ممنوع قراءة جدول settings مباشرة من أي وحدة أخرى.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SETTING_KEYS, type AgeMode, type SettingKey, type SettingRole } from "@/shared/config";
import { resolveEffective, validateValue, type EffectiveSetting, type SettingRow } from "./resolve";

type Db = SupabaseClient;

async function loadProfileAgeMode(db: Db, profileId: string): Promise<AgeMode | null> {
  const { data, error } = await db.from("profiles").select("age_mode").eq("id", profileId).maybeSingle();
  if (error) throw error;
  return (data?.age_mode as AgeMode | null) ?? null;
}

async function loadRows(db: Db, profileId: string, key?: string): Promise<SettingRow[]> {
  let q = db
    .from("settings")
    .select("key, value, set_by_role, set_by_user_id, locked, locked_by_user_id, updated_at")
    .eq("profile_id", profileId);
  if (key) q = q.eq("key", key);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SettingRow[];
}

export async function effective<T = unknown>(db: Db, profileId: string, key: SettingKey, missionOverride?: unknown): Promise<EffectiveSetting<T>> {
  const [ageMode, rows] = await Promise.all([loadProfileAgeMode(db, profileId), loadRows(db, profileId, key)]);
  return resolveEffective<T>({ key, ageMode, rows, missionOverride });
}

/** كل الإعدادات الفعّالة دفعة واحدة (لشاشة الإعدادات CUST-7). */
export async function effectiveAll(db: Db, profileId: string): Promise<{ ageMode: AgeMode | null; rows: SettingRow[]; items: EffectiveSetting[] }> {
  const [ageMode, rows] = await Promise.all([loadProfileAgeMode(db, profileId), loadRows(db, profileId)]);
  const items = SETTING_KEYS.map((key) => resolveEffective({ key, ageMode, rows }));
  return { ageMode, rows, items };
}

export type SetSettingInput = {
  profileId: string;
  key: SettingKey;
  value: unknown;
  role: Exclude<SettingRole, "system">;
  lock?: boolean;
};

/**
 * كتابة إعداد في طبقة. التحقق من القيمة هنا (رسالة واضحة) ثم في قاعدة البيانات (الإنفاذ)،
 * والصلاحيات تُفرض في RLS عبر app.settings_can_write. سجل التدقيق يكتبه الـtrigger.
 */
export async function setSetting(db: Db, input: SetSettingInput): Promise<{ ok: true } | { ok: false; reason: string }> {
  const v = validateValue(input.key, input.value);
  if (!v.ok) return v;
  const { error } = await db.from("settings").upsert(
    {
      profile_id: input.profileId,
      key: input.key,
      value: input.value,
      set_by_role: input.role,
      locked: input.role === "guardian" ? Boolean(input.lock) : false,
    },
    { onConflict: "profile_id,key,set_by_role" },
  );
  if (error) return { ok: false, reason: mapDbError(error.message) };
  return { ok: true };
}

/** إزالة قيمة طبقة (العودة إلى الطبقة التالية). */
export async function clearSetting(db: Db, profileId: string, key: SettingKey, role: Exclude<SettingRole, "system">) {
  const { error } = await db.from("settings").delete().eq("profile_id", profileId).eq("key", key).eq("set_by_role", role);
  if (error) return { ok: false as const, reason: mapDbError(error.message) };
  return { ok: true as const };
}

export async function setLock(db: Db, profileId: string, key: SettingKey, locked: boolean) {
  const { error } = await db.from("settings").update({ locked }).eq("profile_id", profileId).eq("key", key).eq("set_by_role", "guardian");
  if (error) return { ok: false as const, reason: mapDbError(error.message) };
  return { ok: true as const };
}

function mapDbError(msg: string): string {
  if (/row-level security/i.test(msg)) return "not_allowed";
  if (/not in catalog/i.test(msg)) return "key_not_in_catalog";
  if (/out of range|must be|not allowed|exceeds|unknown capability|duplicates/i.test(msg)) return "invalid_value";
  return "db_error";
}
