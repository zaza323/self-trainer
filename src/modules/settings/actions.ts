"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { SETTING_KEYS, catalogEntry, type SettingKey } from "@/shared/config";
import { setSetting, clearSetting, setLock } from "./service";

export type SettingsActionResult = { ok: true } | { ok: false; error: string };

const base = z.object({
  profile_id: z.string().uuid(),
  key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]),
  role: z.enum(["player", "guardian"]),
});

/** يحوّل القيمة النصية من النموذج إلى نوع الكتالوج. */
function parseFormValue(key: SettingKey, raw: FormDataEntryValue | null, rawList: FormDataEntryValue[]): unknown {
  const entry = catalogEntry(key)!;
  const s = raw === null ? "" : String(raw).trim();
  switch (entry.type) {
    case "int": return s === "" ? NaN : Number(s);
    case "int_or_null": return s === "" ? null : Number(s);
    case "bool": return s === "on" || s === "true";
    case "enum": return s;
    case "enum_or_null": return s === "" ? null : (entry.values.every((v) => typeof v === "number") ? Number(s) : s);
    case "capability_array": return rawList.map(String).filter(Boolean);
    case "time_windows": {
      if (s === "") return [];
      try { return JSON.parse(s); } catch { return "invalid"; }
    }
    case "time_local": return s;
    case "time_range": return [String(rawList[0] ?? ""), String(rawList[1] ?? "")];
  }
}

export async function saveSetting(_: unknown, form: FormData): Promise<SettingsActionResult> {
  const parsed = base.extend({ lock: z.string().optional() }).safeParse({
    profile_id: form.get("profile_id"), key: form.get("key"), role: form.get("role"), lock: form.get("lock") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { profile_id, key, role, lock } = parsed.data;
  const value = parseFormValue(key, form.get("value"), form.getAll("value"));
  const db = await createClient();
  const res = await setSetting(db, { profileId: profile_id, key, value, role, lock: lock === "on" });
  if (!res.ok) return { ok: false, error: res.reason };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function resetSetting(_: unknown, form: FormData): Promise<SettingsActionResult> {
  const parsed = base.safeParse({ profile_id: form.get("profile_id"), key: form.get("key"), role: form.get("role") });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const res = await clearSetting(db, parsed.data.profile_id, parsed.data.key, parsed.data.role);
  if (!res.ok) return { ok: false, error: res.reason };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function toggleLock(_: unknown, form: FormData): Promise<SettingsActionResult> {
  const parsed = base.omit({ role: true }).extend({ locked: z.enum(["true", "false"]) }).safeParse({
    profile_id: form.get("profile_id"), key: form.get("key"), locked: form.get("locked"),
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const db = await createClient();
  const res = await setLock(db, parsed.data.profile_id, parsed.data.key, parsed.data.locked === "true");
  if (!res.ok) return { ok: false, error: res.reason };
  revalidatePath("/", "layout");
  return { ok: true };
}
