import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { customization, catalogEntry, SETTING_KEYS, type AgeMode } from "@/shared/config";
import type { GuardianLinkRow } from "@/shared/db/types";
import { effectiveAll } from "./service";
import { canWriteSetting, type SettingsActor } from "./permissions";
import type { SettingView } from "./components/settings-panel";
import labels from "@content/settings_labels.ar.json";
import explainers from "@content/explainers.ar.json";

type Labels = Record<string, { label: string; help: string }> & { enum_values: Record<string, Record<string, string>> };
const L = labels as unknown as Labels;

const HIDDEN_UNTIL_FEATURE = new Set<string>(["moment_windows", "list", "category_list"]);

/** يبني بيانات شاشة الإعدادات (CUST-7) لمتدرب: القيمة الفعّالة، من ضبطها، القفل، وهل يستطيع الفاعل التعديل. */
export async function buildSettingsView(db: SupabaseClient, args: { profileId: string; actor: SettingsActor; links: GuardianLinkRow[] }) {
  const { ageMode, rows, items } = await effectiveAll(db, args.profileId);
  if (!ageMode) return { ageMode: null, views: [] as SettingView[] };
  const creatorUserIds = args.links.filter((l) => l.is_creator && l.status === "active").map((l) => l.guardian_id);
  const who = explainers.settings_who_set as Record<string, string>;

  // مفاتيح المخطط والمرافق الجديدة (0.4) تظهر في الشاشة حين تُبنى ميزتها (واجهة أنواعها المركبة: المراحل 9–11).
  const visibleKeys = SETTING_KEYS.filter((k) => !HIDDEN_UNTIL_FEATURE.has(catalogEntry(k)!.type));
  const views: SettingView[] = visibleKeys.map((key) => {
    const eff = items.find((i) => i.key === key)!;
    const myRow = rows.find((r) => r.key === key && r.set_by_role === args.actor.role) ?? null;
    const common = { key, ageMode: ageMode as AgeMode, actor: args.actor, rows, creatorUserIds };
    const whoSet = eff.setBy?.userId === args.actor.userId ? `${who[eff.source]} (أنت)` : who[eff.source] ?? eff.source;
    return {
      key,
      entry: catalogEntry(key)!,
      label: L[key]?.label ?? key,
      help: L[key]?.help ?? "",
      enumLabels: L.enum_values[key] ?? {},
      effective: eff,
      myRow,
      canEdit: canWriteSetting(common),
      canLock: canWriteSetting({ ...common, lock: true }),
      whoSet,
    };
  });
  return { ageMode, views };
}

export const guardrailsList = customization.guardrails_not_configurable;
