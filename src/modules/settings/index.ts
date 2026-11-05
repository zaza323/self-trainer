/**
 * وحدة الإعدادات — الواجهة العامة. أي وحدة أخرى تستورد من هنا فقط.
 */
export { resolveEffective, validateValue, clampValue, playerLayerApplies } from "./resolve";
export type { EffectiveSetting, EffectiveSource, SettingRow } from "./resolve";
export { canWriteSetting, isLockableKey } from "./permissions";
export type { SettingsActor, EditDecision } from "./permissions";
export { effective, effectiveAll, setSetting, clearSetting, setLock } from "./service";
export type { SetSettingInput } from "./service";
