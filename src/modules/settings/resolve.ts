/**
 * نواة نظام الإعدادات بالطبقات (4.11.1) — دوال نقية بلا قاعدة بيانات.
 *
 * effective(key) =
 *   تجاوز المهمة (إن سمح الإعداد)
 *   ← إعداد المتدرب (إن لم يكن مقفلًا وكان الوضع يسمح له)
 *   ← إعداد المربي
 *   ← [صف النظام إن وُجد: قيمة كتبها المحرك لهذا الملف]
 *   ← الافتراضي حسب الوضع العمري
 *   ← الافتراضي العام (= افتراضي adult عندما لا وضع عمري للملف)
 * ثم clamp إلى حدود الإعداد في الكتالوج.
 *
 * ترتيب الطبقات نفسه يُقرأ من config/customization.json.resolution_order.
 */
import {
  customization,
  catalogEntry,
  type AgeMode,
  type CatalogEntry,
  type SettingRole,
  CAPABILITY_IDS,
} from "@/shared/config";

export type SettingRow = {
  key: string;
  value: unknown;
  set_by_role: SettingRole;
  set_by_user_id: string | null;
  locked: boolean;
  locked_by_user_id: string | null;
  updated_at?: string;
};

export type EffectiveSource = "mission_override" | "player" | "guardian" | "system" | "age_mode_default" | "system_default";

export type EffectiveSetting<T = unknown> = {
  key: string;
  value: T;
  source: EffectiveSource;
  setBy: { userId: string | null; role: SettingRole } | null;
  locked: boolean;
  lockedBy: string | null;
  /** القيمة قبل القص (للتدقيق فقط) */
  rawValue: unknown;
};

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** الافتراضي العام عندما لا وضع عمري للملف (حساب مربٍ) — موثّق في README الوحدة. */
const SYSTEM_DEFAULT_MODE: AgeMode = "adult";

export function catalogDefault(entry: CatalogEntry, ageMode: AgeMode | null): { value: unknown; source: EffectiveSource } {
  if (ageMode) return { value: entry.default[ageMode], source: "age_mode_default" };
  return { value: entry.default[SYSTEM_DEFAULT_MODE], source: "system_default" };
}

/** هل يُسمح للمتدرب في هذا الوضع بأن تُحتسب طبقته لهذا المفتاح؟ */
export function playerLayerApplies(key: string, ageMode: AgeMode | null): boolean {
  if (!ageMode) return false;
  const rule = customization.edit_rules[ageMode];
  if (rule.player === "all") return true;
  return customization.player_editable_in_child.includes(key);
}

/**
 * يقصّ القيمة إلى حدود الكتالوج. القيمة غير الصالحة تمامًا تعود إلى الافتراضي
 * (القراءة متسامحة؛ الكتابة صارمة عبر validateValue).
 */
export function clampValue(entry: CatalogEntry, value: unknown, fallback: unknown): unknown {
  switch (entry.type) {
    case "int": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
      return Math.min(entry.max, Math.max(entry.min, Math.round(value)));
    }
    case "int_or_null": {
      if (value === null) return null;
      if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
      return Math.min(entry.max, Math.max(entry.min, Math.round(value)));
    }
    case "int_or_auto": {
      if (value === "auto") return "auto";
      if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
      return Math.min(entry.max ?? Number.MAX_SAFE_INTEGER, Math.max(entry.min, Math.round(value)));
    }
    case "bool":
      return typeof value === "boolean" ? value : fallback;
    case "enum":
      return typeof value === "string" && entry.values.includes(value) ? value : fallback;
    case "enum_array": {
      if (!Array.isArray(value)) return fallback;
      const out: string[] = [];
      for (const v of value) if (typeof v === "string" && entry.values.includes(v) && !out.includes(v)) out.push(v);
      return out;
    }
    case "time_local_or_null":
      if (value === null) return null;
      return typeof value === "string" && TIME_RE.test(value) ? value : fallback;
    case "moment_windows":
      return isMomentWindows(value) ? value : fallback;
    case "list":
      return Array.isArray(value) && value.every((v) => isListItem(entry.item, v)) ? value.slice(0, entry.max_items) : fallback;
    case "category_list": {
      if (!Array.isArray(value)) return fallback;
      const out: string[] = [];
      for (const v of value) if (typeof v === "string" && v && !out.includes(v)) out.push(v);
      return out.slice(0, entry.max_items);
    }
    case "enum_or_null":
      if (value === null) return null;
      return (typeof value === "string" || typeof value === "number") && entry.values.includes(value) ? value : fallback;
    case "capability_array": {
      if (!Array.isArray(value)) return fallback;
      const ids = new Set<string>(CAPABILITY_IDS);
      const out: string[] = [];
      for (const v of value) if (typeof v === "string" && ids.has(v) && !out.includes(v)) out.push(v);
      return out.slice(0, entry.max_items);
    }
    case "time_windows": {
      if (!Array.isArray(value)) return fallback;
      return value.filter(isTimeWindow).slice(0, entry.max_items);
    }
    case "time_local":
      return typeof value === "string" && TIME_RE.test(value) ? value : fallback;
    case "time_range":
      return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string" && TIME_RE.test(v))
        ? value
        : fallback;
  }
}

export function isTimeWindow(v: unknown): v is { from: string; to: string } {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as { from?: unknown }).from === "string" && TIME_RE.test((v as { from: string }).from) &&
    typeof (v as { to?: unknown }).to === "string" && TIME_RE.test((v as { to: string }).to)
  );
}

export function isMomentWindows(v: unknown): v is Record<string, [string, string]> {
  return typeof v === "object" && v !== null && !Array.isArray(v) &&
    Object.values(v).every((w) => Array.isArray(w) && w.length === 2 && w.every((x) => typeof x === "string" && x.length > 0));
}

/** عنصر قائمة مخصصة: كل حقل من نوعه المعلن في الكتالوج ("string" نص غير فارغ، "int" عدد صحيح موجب). */
export function isListItem(spec: Record<string, string>, v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Object.entries(spec).every(([k, kind]) => (kind === "int" ? Number.isInteger(o[k]) && (o[k] as number) > 0 : typeof o[k] === "string" && (o[k] as string).trim().length > 0));
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/** تحقق صارم قبل الكتابة (CUST-2). يطابق app.settings_validate() في قاعدة البيانات. */
export function validateValue(key: string, value: unknown): ValidationResult {
  const entry = catalogEntry(key);
  if (!entry) return { ok: false, reason: "key_not_in_catalog" };
  switch (entry.type) {
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, reason: "must_be_integer" };
      if (value < entry.min || value > entry.max) return { ok: false, reason: "out_of_range" };
      return { ok: true };
    case "int_or_null":
      if (value === null) return { ok: true };
      if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, reason: "must_be_integer_or_null" };
      if (value < entry.min || value > entry.max) return { ok: false, reason: "out_of_range" };
      return { ok: true };
    case "int_or_auto":
      if (value === "auto") return { ok: true };
      if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, reason: "must_be_integer_or_auto" };
      if (value < entry.min || value > (entry.max ?? Number.MAX_SAFE_INTEGER)) return { ok: false, reason: "out_of_range" };
      return { ok: true };
    case "bool":
      return typeof value === "boolean" ? { ok: true } : { ok: false, reason: "must_be_boolean" };
    case "enum":
      return typeof value === "string" && entry.values.includes(value) ? { ok: true } : { ok: false, reason: "value_not_allowed" };
    case "enum_array":
      if (!Array.isArray(value)) return { ok: false, reason: "must_be_array" };
      if (!value.every((v) => typeof v === "string" && entry.values.includes(v))) return { ok: false, reason: "value_not_allowed" };
      return new Set(value).size === value.length ? { ok: true } : { ok: false, reason: "duplicate_items" };
    case "time_local_or_null":
      if (value === null) return { ok: true };
      return typeof value === "string" && TIME_RE.test(value) ? { ok: true } : { ok: false, reason: "must_be_hh_mm" };
    case "moment_windows":
      return isMomentWindows(value) ? { ok: true } : { ok: false, reason: "must_be_moment_windows" };
    case "list":
      if (!Array.isArray(value)) return { ok: false, reason: "must_be_array" };
      if (value.length > entry.max_items) return { ok: false, reason: "too_many_items" };
      return value.every((v) => isListItem(entry.item, v)) ? { ok: true } : { ok: false, reason: "invalid_item" };
    case "category_list":
      if (!Array.isArray(value)) return { ok: false, reason: "must_be_array" };
      if (value.length > entry.max_items) return { ok: false, reason: "too_many_items" };
      if (!value.every((v) => typeof v === "string" && v.length > 0) || new Set(value).size !== value.length) return { ok: false, reason: "invalid_item" };
      return entry.unknown_required && !value.includes("unknown") ? { ok: false, reason: "unknown_required" } : { ok: true };
    case "enum_or_null":
      if (value === null) return { ok: true };
      return (typeof value === "string" || typeof value === "number") && entry.values.includes(value)
        ? { ok: true }
        : { ok: false, reason: "value_not_allowed" };
    case "capability_array": {
      if (!Array.isArray(value)) return { ok: false, reason: "must_be_array" };
      if (value.length > entry.max_items) return { ok: false, reason: "too_many_items" };
      const ids = new Set<string>(CAPABILITY_IDS);
      if (!value.every((v) => typeof v === "string" && ids.has(v))) return { ok: false, reason: "unknown_capability" };
      if (new Set(value).size !== value.length) return { ok: false, reason: "duplicate_items" };
      return { ok: true };
    }
    case "time_windows":
      if (!Array.isArray(value)) return { ok: false, reason: "must_be_array" };
      if (value.length > entry.max_items) return { ok: false, reason: "too_many_items" };
      return value.every(isTimeWindow) ? { ok: true } : { ok: false, reason: "invalid_time_window" };
    case "time_local":
      return typeof value === "string" && TIME_RE.test(value) ? { ok: true } : { ok: false, reason: "must_be_hh_mm" };
    case "time_range":
      return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string" && TIME_RE.test(v))
        ? { ok: true }
        : { ok: false, reason: "must_be_time_range" };
  }
}

export type ResolveInput = {
  key: string;
  ageMode: AgeMode | null;
  rows: SettingRow[];
  missionOverride?: unknown;
};

/** الدالة النقية التي تعتمد عليها settings.effective(). */
export function resolveEffective<T = unknown>({ key, ageMode, rows, missionOverride }: ResolveInput): EffectiveSetting<T> {
  const entry = catalogEntry(key);
  if (!entry) throw new Error(`setting key "${key}" is not in catalog`);

  const mine = rows.filter((r) => r.key === key);
  const byRole = (role: SettingRole) => mine.find((r) => r.set_by_role === role);
  const lockRow = mine.find((r) => r.locked);
  const def = catalogDefault(entry, ageMode);

  let picked: { value: unknown; source: EffectiveSource; row: SettingRow | null } | null = null;

  for (const layer of customization.resolution_order) {
    if (layer === "mission_override") {
      if (entry.mission_override && missionOverride !== undefined) {
        picked = { value: missionOverride, source: "mission_override", row: null };
      }
    } else if (layer === "player") {
      const row = byRole("player");
      if (row && !lockRow && playerLayerApplies(key, ageMode)) picked = { value: row.value, source: "player", row };
    } else if (layer === "guardian") {
      const row = byRole("guardian");
      if (row) picked = { value: row.value, source: "guardian", row };
      else {
        const sys = byRole("system");
        if (sys) picked = { value: sys.value, source: "system", row: sys };
      }
    } else if (layer === "age_mode_default") {
      if (ageMode) picked = { value: entry.default[ageMode], source: "age_mode_default", row: null };
    } else if (layer === "system_default") {
      picked = { value: def.value, source: def.source, row: null };
    }
    if (picked) break;
  }
  if (!picked) picked = { value: def.value, source: def.source, row: null };

  return {
    key,
    value: clampValue(entry, picked.value, def.value) as T,
    source: picked.source,
    setBy: picked.row ? { userId: picked.row.set_by_user_id, role: picked.row.set_by_role } : null,
    locked: Boolean(lockRow),
    lockedBy: lockRow?.locked_by_user_id ?? null,
    rawValue: picked.value,
  };
}
