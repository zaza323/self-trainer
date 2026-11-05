/**
 * آلة حالات المهمة (4.5، MIS-1) — مرآة TypeScript لـ app.mission_transition_allowed في قاعدة البيانات.
 * قاعدة البيانات هي من يُنفذ؛ هذه النسخة للواجهة والاختبارات.
 */
export const MISSION_STATUSES = ["suggested", "chosen", "planned", "in_progress", "interrupted", "completed", "abandoned", "reflected", "transferred"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const ALLOWED_TRANSITIONS: ReadonlyArray<readonly [MissionStatus, MissionStatus]> = [
  ["suggested", "chosen"],
  ["chosen", "planned"],
  ["planned", "in_progress"],
  ["in_progress", "interrupted"],
  ["interrupted", "in_progress"],
  ["in_progress", "completed"],
  ["in_progress", "abandoned"],
  ["interrupted", "abandoned"],
  ["completed", "reflected"],
  ["abandoned", "reflected"],
  ["reflected", "transferred"],
];

export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function nextStatuses(from: MissionStatus): MissionStatus[] {
  return ALLOWED_TRANSITIONS.filter(([f]) => f === from).map(([, t]) => t);
}

/** مرحلة الدورة التي تعرضها الواجهة لكل حالة (جدول 4.5). */
export const CYCLE_STAGE: Record<MissionStatus, "goal_choice" | "choice" | "resist_act" | "act" | "reflect" | "transfer"> = {
  suggested: "goal_choice",
  chosen: "goal_choice",
  planned: "choice",
  in_progress: "resist_act",
  interrupted: "resist_act",
  completed: "act",
  abandoned: "act",
  reflected: "reflect",
  transferred: "transfer",
};

export const TERMINAL_FOR_TODAY: ReadonlySet<MissionStatus> = new Set(["reflected", "transferred"]);
export const OPEN_STATUSES: ReadonlyArray<MissionStatus> = ["suggested", "chosen", "planned", "in_progress", "interrupted", "completed", "abandoned"];
