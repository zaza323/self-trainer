import type { MissionStatus } from "./state-machine";
import type { SupportLevel } from "@/shared/config";

export type DistractionChoice = "ignore" | "break_return" | "give_in";

export type MissionRow = {
  id: string;
  profile_id: string;
  template_id: string;
  template_version: number;
  goal_id: string | null;
  status: MissionStatus;
  difficulty: number;
  support_level: SupportLevel;
  variables: Record<string, string | number>;
  strategy_chosen: string | null;
  custom_strategy: string | null;
  custom_strategy_label: string | null;
  time_estimate: number | null;
  prediction: { minutes?: number; count?: number } | null;
  actual_duration_min: number | null;
  hints_used: number;
  distraction_log: Array<{ at: string; choice: DistractionChoice }>;
  interruption_reasons: Array<{ at: string; reason: string }>;
  checklist_done: number[];
  gate1: boolean | null;
  gate2: "shown" | "partial" | "not_yet" | null;
  gate2_score: number | null;
  started_at: string | null;
  completed_at: string | null;
  context_tag: string | null;
  source: "engine" | "self" | "guardian" | "guardian_recurring";
  suggested_for: string;
  dismissed: boolean;
  needs_approval: boolean;
  created_at: string;
  updated_at: string;
};

export type ReflectionRow = { id: string; mission_id: string; prompts_and_answers: Array<{ prompt: string; answer: string }>; summary: string | null; created_at: string };
