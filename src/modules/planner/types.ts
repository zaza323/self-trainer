import type { PlannerPriority } from "@/shared/config";

export type PlannerTaskStatus = "open" | "done" | "cancelled";
export type PlannerCreatedVia = "manual" | "nlp" | "voice" | "guardian" | "ai_breakdown";

export type PlannerTaskRow = {
  id: string;
  profile_id: string;
  project_id: string | null;
  section_id: string | null;
  parent_task_id: string | null;
  title: string;
  notes: string | null;
  priority: PlannerPriority;
  due_date: string | null;        // YYYY-MM-DD
  due_time: string | null;        // HH:MM(:SS)
  estimate_min: number | null;
  actual_min: number | null;
  status: PlannerTaskStatus;
  completed_at: string | null;
  cancel_reason: string | null;
  recurrence_rrule: string | null;
  recur_from: "schedule" | "completion";
  important: boolean;
  urgent: boolean;
  kanban_column: string | null;
  postpone_count: number;
  postpone_prompted: boolean;
  created_via: PlannerCreatedVia;
  created_by: string | null;
  auto_rescheduled: boolean;
  linked_goal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PlannerProjectRow = { id: string; profile_id: string; name: string; color: string | null; context_tag: string | null; archived: boolean; order: number };
export type PlannerSectionRow = { id: string; project_id: string; name: string; order: number };
export type PlannerTagRow = { id: string; profile_id: string; name: string; color: string | null };
export type PlannerChecklistRow = { id: string; task_id: string; text: string; done: boolean; order: number };
export type PlannerReminderRow = { id: string; task_id: string; kind: "absolute" | "relative" | "place"; at: string | null; offset_min: number | null; place_id: string | null; important: boolean; snoozed_until: string | null; sent_at: string | null };
export type PlannerSavedFilterRow = { id: string; profile_id: string; name: string; query: Record<string, unknown> };
