/**
 * أنواع قاعدة البيانات للمرحلة 0 (مكتوبة يدويًا لتطابق supabase/migrations/0001).
 * عند توفر مشروع Supabase: `supabase gen types typescript` يستبدل هذا الملف.
 */
import type { AgeMode } from "@/shared/config";
import type { GuardianRelation, PermissionSet } from "@/shared/config/permissions";

export type ProfileRow = {
  id: string;
  user_id: string;
  kind: "player" | "guardian";
  display_name: string;
  age_mode: AgeMode | null;
  locale: string;
  timezone: string;
  space_theme: string | null;
  incentive_stage: number;
  planner_tier_max: number;
  onboarding_path: "reality" | "goals" | null;
  game_intensity: number | null;
  game_intensity_override: number | null;
  avatar_stage_max: number;
  login_code: string | null;
  created_by: string | null;
  onboarded_at: string | null;
  created_at: string;
};

export type GuardianLinkRow = {
  id: string;
  guardian_id: string;
  player_id: string;
  relation: GuardianRelation;
  is_creator: boolean;
  permissions: PermissionSet;
  status: "invited" | "active" | "removed";
  invited_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GuardianInviteRow = {
  id: string;
  player_id: string;
  invited_by: string;
  email: string | null;
  code: string;
  relation: GuardianRelation;
  permissions: PermissionSet;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
};

export type SettingsAuditRow = {
  id: string;
  profile_id: string;
  key: string;
  old_value: unknown;
  new_value: unknown;
  actor_id: string | null;
  actor_role: string;
  source: "manual" | "adaptation_suggestion" | "age_transition";
  config_version: string | null;
  at: string;
};
