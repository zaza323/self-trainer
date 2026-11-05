import { customization, game, limits, support, CONFIG_VERSION, CAPABILITY_IDS } from "./index";
import capabilitiesContent from "@content/capabilities.ar.json";
import mechanicsContent from "@content/mechanics.ar.json";
import achievementsContent from "@content/achievements.ar.json";

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const jsonLit = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;
const numOrNull = (v: unknown) => (typeof v === "number" ? String(v) : "null");

/** يبني SQL مُعادًا تشغيله (idempotent) لمزامنة الكتالوج والجداول الثابتة. */
export function buildConfigSyncSql(): string {
  const lines: string[] = [];

  for (const id of CAPABILITY_IDS) {
    const c = (capabilitiesContent as unknown as Record<string, { name: string; description: string }>)[id];
    if (!c) throw new Error(`content/capabilities.ar.json missing ${id}`);
    lines.push(
      `insert into public.capabilities (id, name_ar, description_ar) values (${lit(id)}, ${lit(c.name)}, ${lit(c.description)})
       on conflict (id) do update set name_ar = excluded.name_ar, description_ar = excluded.description_ar;`,
    );
  }
  for (const [id, m] of Object.entries(mechanicsContent as Record<string, unknown>)) {
    if (id.startsWith("_")) continue;
    const mech = m as { name: string; primary_capability: string };
    lines.push(
      `insert into public.mechanics (id, name_ar, primary_capability_id) values (${lit(id)}, ${lit(mech.name)}, ${lit(mech.primary_capability)})
       on conflict (id) do update set name_ar = excluded.name_ar, primary_capability_id = excluded.primary_capability_id;`,
    );
  }

  for (const [code, a] of Object.entries(achievementsContent as Record<string, unknown>)) {
    if (code.startsWith("_")) continue;
    const ach = a as { icon: string; name: Record<string, string>; description: Record<string, string> };
    lines.push(
      `insert into public.achievements (code, name_by_mode, description_by_mode, icon, owner_profile_id) values (${lit(code)}, ${jsonLit(ach.name)}, ${jsonLit(ach.description)}, ${lit(ach.icon)}, null)
       on conflict (code) where owner_profile_id is null do update set name_by_mode = excluded.name_by_mode, description_by_mode = excluded.description_by_mode, icon = excluded.icon;`,
    );
  }

  const editable = new Set(customization.player_editable_in_child);
  for (const [key, entry] of Object.entries(customization.catalog)) {
    const e = entry as Record<string, unknown>;
    lines.push(
      `insert into public.settings_catalog (key, type, min, max, allowed_values, max_items, defaults, mission_override, player_editable_in_child, config_version)
       values (${lit(key)}, ${lit(entry.type)}, ${numOrNull(e.min)}, ${numOrNull(e.max)},
               ${"values" in entry ? jsonLit(entry.values) : "null"}, ${numOrNull(e.max_items)},
               ${jsonLit(entry.default)}, ${entry.mission_override}, ${editable.has(key)}, ${lit(CONFIG_VERSION)})
       on conflict (key) do update set type = excluded.type, min = excluded.min, max = excluded.max,
         allowed_values = excluded.allowed_values, max_items = excluded.max_items, defaults = excluded.defaults,
         mission_override = excluded.mission_override, player_editable_in_child = excluded.player_editable_in_child,
         config_version = excluded.config_version;`,
    );
  }
  const keys = Object.keys(customization.catalog).map(lit).join(", ");
  lines.push(`delete from public.settings_catalog where key not in (${keys});`);

  lines.push(
    `insert into public.config_meta (id, edit_rules, resolution_order, limits, support, rewards, config_version, synced_at)
     values (1, ${jsonLit({ ...customization.edit_rules, _guardian_temporary_support: customization.guardian_temporary_support, _challenges: game.challenges })}, ${jsonLit(customization.resolution_order)}, ${jsonLit(limits)}, ${jsonLit(support)}, ${jsonLit(customization.real_rewards)}, ${lit(CONFIG_VERSION)}, now())
     on conflict (id) do update set edit_rules = excluded.edit_rules, resolution_order = excluded.resolution_order,
       limits = excluded.limits, support = excluded.support, rewards = excluded.rewards, config_version = excluded.config_version, synced_at = now();`,
  );
  return lines.join("\n");
}
