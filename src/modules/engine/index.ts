/** محرك التخصيص (ENGINE-1..6) — المرحلة 1: قواعد ثابتة فقط. */
export { selectSuggestions, adaptiveDifficulty, defaultVariablesFor } from "./select";
export type { Suggestion, HistoryItem, SelectInput, CapabilityStateLite } from "./select";
export { ensureDailySuggestions } from "./service";
