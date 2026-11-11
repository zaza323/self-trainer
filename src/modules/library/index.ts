/** وحدة مكتبة القوالب (LIB-1..3). الواجهة العامة. */
export { templateSchema, textByMode, primaryCapability, fillVariables } from "./schema";
export { scenarioText } from "./scenario";
export type { MissionTemplate, ByModeText } from "./schema";
export { loadActiveTemplates, loadTemplate, rowToTemplate } from "./db";
