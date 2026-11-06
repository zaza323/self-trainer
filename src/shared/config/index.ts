/**
 * المصدر الوحيد لكل قيمة قابلة للضبط. لا أرقام في الكود: كل شيء يُقرأ من config/*.json
 * ويُتحقق منه بـ Zod عند أول استيراد حتى يفشل التشغيل مبكرًا إذا تعطّل ملف إعدادات.
 */
import { z } from "zod";
import scoringJson from "@config/scoring.json";
import supportJson from "@config/support.json";
import gameJson from "@config/game.json";
import customizationJson from "@config/customization.json";
import aiJson from "@config/ai.json";
import limitsJson from "@config/limits.json";
import trialJson from "@config/trial.json";
import plannerJson from "@config/planner.json";

export const AGE_MODES = ["child", "teen", "adult"] as const;
export type AgeMode = (typeof AGE_MODES)[number];

export const SETTING_ROLES = ["player", "guardian", "system"] as const;
export type SettingRole = (typeof SETTING_ROLES)[number];

export const CAPABILITY_IDS = [
  "self_awareness",
  "motive_awareness",
  "self_control",
  "attention",
  "thinking",
  "perseverance",
  "planning",
  "autonomy",
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const SUPPORT_LEVELS = ["L0_instruct", "L1_hint", "L2_ask", "L3_free"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const MECHANIC_IDS = [
  "delay_reward", "resist_distraction", "decompose", "prioritize", "face_obstacle",
  "self_monitor", "resume", "decide_alone", "review_outcome", "plan_ahead",
] as const;
export type MechanicId = (typeof MECHANIC_IDS)[number];

export const TRAINING_LEVELS = ["simulated", "guided_real", "independent_real", "transfer"] as const;
export type TrainingLevel = (typeof TRAINING_LEVELS)[number];

export const RESPONSE_MODES = ["quick_replies", "choices_plus_other", "free_text"] as const;
export type ResponseMode = (typeof RESPONSE_MODES)[number];
export const MOMENTS = ["confirm", "logistics", "feeling_check", "strategy_choice", "goal_why", "goal_what", "reflection_core", "reflection_secondary", "obstacle_naming", "priority_pick", "stuck", "free_chat"] as const;
export type Moment = (typeof MOMENTS)[number];
export const OPTION_SOURCES = ["user_words", "template", "ai"] as const;
export type OptionSource = (typeof OPTION_SOURCES)[number];

const byMode = <T extends z.ZodTypeAny>(v: T) => z.object({ child: v, teen: v, adult: v });

const catalogExtras = { allowed_age_modes: z.array(z.enum(AGE_MODES)).optional(), max_by_age_mode: byMode(z.number()).optional(), semantics: z.string().optional() };
const catalogEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("int"), min: z.number(), max: z.number(), default: byMode(z.number()), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("int_or_null"), min: z.number(), max: z.number(), default: byMode(z.number().nullable()), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("int_or_auto"), min: z.number(), max: z.number().optional(), default: byMode(z.union([z.number(), z.literal("auto")])), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("bool"), default: byMode(z.boolean()), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("enum"), values: z.array(z.string()), default: byMode(z.string()), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("enum_or_null"), values: z.array(z.union([z.string(), z.number()])), default: byMode(z.union([z.string(), z.number()]).nullable()), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("enum_array"), values: z.array(z.string()), default: byMode(z.array(z.string())), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("capability_array"), max_items: z.number(), default: byMode(z.array(z.enum(CAPABILITY_IDS))), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("time_windows"), max_items: z.number(), default: byMode(z.array(z.unknown())), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("time_local"), default: byMode(z.string()), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("time_local_or_null"), default: byMode(z.string().nullable()), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("time_range"), default: byMode(z.tuple([z.string(), z.string()])), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("moment_windows"), default: byMode(z.record(z.string(), z.tuple([z.string(), z.string()]))), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("list"), max_items: z.number(), item: z.record(z.string(), z.string()), default: byMode(z.array(z.unknown())), mission_override: z.boolean(), ...catalogExtras }),
  z.object({ type: z.literal("category_list"), max_items: z.number(), unknown_required: z.boolean(), default: byMode(z.array(z.string())), mission_override: z.boolean(), ...catalogExtras }),
]);
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

const editRuleSchema = z.object({
  player: z.enum(["all", "player_editable_keys_only"]),
  guardian: z.string(),
  guardian_can_lock: z.boolean(),
  creator_can_lock_against_guardians: z.boolean().optional(),
  lockable_keys_override: z.array(z.string()).optional(),
});

const customizationSchema = z.object({
  config_version: z.string(),
  resolution_order: z.array(z.enum(["mission_override", "player", "guardian", "age_mode_default", "system_default"])),
  edit_rules: byMode(editRuleSchema),
  player_editable_in_child: z.array(z.string()),
  catalog: z.record(z.string(), catalogEntrySchema),
  guardrails_not_configurable: z.array(z.string()),
  guardian_temporary_support: z.object({
    allowed_direction: z.string(),
    levels: z.number(),
    duration_days: z.number(),
    requires_permission: z.string(),
  }),
  real_rewards: z.object({
    max_active_per_player: z.number().int(),
    allowed_triggers: z.record(z.string(), z.object({ params: z.record(z.string(), z.unknown()) })),
    forbidden_triggers: z.array(z.string()),
    no_retroactive_evaluation: z.boolean(),
    stage_guidance_from_stage: z.number().int(),
    creation_hint_key: z.string(),
    creator_permission: z.string(),
    adult_self_rewards: z.boolean(),
  }),
  custom_achievements: z.object({ creator_permission: z.string(), max_active_per_player: z.number().int(), allowed_triggers_from: z.string(), exclude_triggers: z.array(z.string()) }),
  adaptation: z.object({
    run_every_days: z.number().int().positive(), lookback_days: z.number().int().positive(), max_suggestions_per_run: z.number().int().positive(),
    reject_cooldown_days: z.number().int().positive(), expire_after_days: z.number().int().positive(), approver_permission: z.string(),
    allowed_types: z.record(z.string(), z.object({ setting_key: z.string().nullable(), engine_hint_days: z.number().int().positive().optional(), action: z.string().optional(), audience: z.string().optional() })),
  }),
  personal_context: z.object({ fields: z.array(z.enum(["interests", "routine", "free_windows", "contexts"])), max_items_per_field: z.number().int(), forbidden_content: z.array(z.string()), suggestions_require_user_confirmation: z.boolean() }),
  strategy_memory: z.object({ show_in_planning_up_to_support_level: z.enum(SUPPORT_LEVELS), min_uses_to_show: z.number().int().positive(), min_shown_rate_to_show: z.number().min(0).max(1) }),
  template_metrics: z.object({ min_missions_to_evaluate: z.number().int().positive(), flag_if_shown_rate_below: z.number().min(0).max(1), flag_if_abandon_rate_above: z.number().min(0).max(1), recompute_every_days: z.number().int().positive() }),
  permissions_all: z.array(z.string()),
  permission_defaults: z.record(z.string(), z.record(z.string(), z.boolean())),
});

const supportSchema = z.object({
  config_version: z.string(),
  levels: z.array(z.enum(SUPPORT_LEVELS)),
  initial_by_age_mode: byMode(z.enum(SUPPORT_LEVELS)),
  evaluate_when_capability_weight_at_least: z.number(),
  promote: z.object({ window_missions: z.number().int(), min_gate2_shown: z.number().int(), max_total_hints: z.number().int(), max_abandoned: z.number().int(), min_confidence: z.number(), min_missions_since_last_change: z.number().int() }),
  demote: z.object({ window_missions: z.number().int(), min_struggles: z.number().int(), struggle_states: z.array(z.string()), min_missions_since_last_change: z.number().int() }),
  training_levels: z.object({
    order: z.array(z.enum(["simulated", "guided_real", "independent_real", "transfer"])),
    advance: z.object({
      simulated_to_guided_real: z.object({ min_shown: z.number().int(), min_confidence: z.number() }),
      guided_real_to_independent_real: z.object({ min_shown: z.number().int(), min_support_level: z.enum(SUPPORT_LEVELS) }),
      independent_real_to_transfer: z.object({ min_shown: z.number().int(), min_worked_transfer_reports: z.number().int() }),
      transfer_to_mastered: z.object({ min_worked_transfer_reports: z.number().int(), min_distinct_contexts: z.number().int(), min_score: z.number(), min_confidence: z.number(), required_support_level: z.enum(SUPPORT_LEVELS) }),
    }),
    auto_downgrade: z.boolean(),
    warmup_lower_level_per_week: z.number().int(),
  }),
  mastery_check: z.object({
    interval_days: z.number().int(), jitter_days: z.number().int(), requires_novel_context: z.boolean(),
    on_fail: z.object({ set_training_level: z.enum(["simulated", "guided_real", "independent_real", "transfer"]), support_level_delta: z.number().int(), support_level_floor: z.enum(SUPPORT_LEVELS) }),
  }),
});

const scoringSchema = z.object({
  config_version: z.string(),
  source_weights: z.object({ auto: z.number(), guardian: z.number(), ai: z.number(), self: z.number(), companion: z.number() }),
  support_multipliers: z.object({ L0_instruct: z.number(), L1_hint: z.number(), L2_ask: z.number(), L3_free: z.number() }),
  value_defaults: z.object({
    distraction_choice_map: z.object({ ignore: z.number(), break_return: z.number(), give_in: z.number() }),
    prediction_tolerance: z.number(),
    hint_count_map: z.object({ "0": z.number(), "1": z.number(), "2+": z.number() }),
    recovery: z.object({ resumed_completed: z.number(), resumed_abandoned_reflected: z.number() }),
    transfer_report: z.object({ worked: z.number(), not_worked: z.number() }),
    guardian_observation: z.object({ positive: z.number(), mixed: z.number(), needs_support: z.number() }),
  }),
  global_rules: z.object({
    G1_recovery: z.object({ capability: z.literal("perseverance"), rule_weight: z.number() }),
    G2_help_needed: z.object({ capability: z.literal("autonomy"), rule_weight: z.number(), min_support_level: z.enum(SUPPORT_LEVELS) }),
    G3_novel_context: z.object({ capability: z.literal("primary"), rule_weight: z.number(), exclude_training_levels: z.array(z.string()) }),
    G4_reflection_quality: z.object({ rule_weight: z.number(), max_candidates: z.number().int(), extra_allowed_capabilities: z.array(z.enum(CAPABILITY_IDS)) }),
  }),
  capability_score: z.object({ half_life_days: z.number(), shrinkage_k: z.number(), confidence_mass_scale: z.number(), context_min_weight: z.number(), contexts_for_full_confidence: z.number() }),
  display: z.object({
    confidence_bands: z.object({ unknown_below: z.number(), tentative_below: z.number() }),
    score_bands: z.object({ needs_support_below: z.number(), growing_below: z.number() }),
    decline: z.object({ min_drop_points: z.number(), lookback_days: z.number(), min_confidence: z.number() }),
  }),
  gate2: z.object({ shown_min_score: z.number(), partial_min_score: z.number(), shown_min_events: z.number().int(), shown_requires_sources: z.array(z.enum(["auto", "guardian", "ai", "self", "companion"])) }),
  engine: z.object({
    easy_success: z.object({ gate1: z.boolean(), gate2: z.string(), max_hints: z.number().int() }),
    struggle: z.object({ any_of: z.array(z.string()) }),
    difficulty_up_after: z.number().int(),
    difficulty_down_after: z.number().int(),
  }),
});

const gameSchema = z.object({
  config_version: z.string(),
  incentive_stages: z.object({
    active_capability_min_confidence: z.number(),
    advance: z.object({
      "1_attract_to_2_competence": z.object({ min_days_since_onboarding: z.number().int(), min_reflected_missions: z.number().int(), min_capabilities_with_confidence: z.number().int() }),
      "2_competence_to_3_meaning": z.object({ min_avg_support: z.number(), min_self_created_reflected_missions: z.number().int(), min_transfer_reports: z.number().int() }),
      "3_meaning_to_4_autonomy": z.object({ min_avg_support: z.number(), min_capabilities_at_or_above: z.object({ level: z.enum(["simulated", "guided_real", "independent_real", "transfer"]), count: z.number().int() }), min_transfer_reports_last_30_days: z.number().int() }),
    }),
    auto_downgrade: z.boolean(),
  }),
  intensity: z.object({
    base_by_stage: z.object({ "1": z.number(), "2": z.number(), "3": z.number(), "4": z.number() }),
    avg_support_penalty_per_level: z.number(),
    age_factor: byMode(z.number()),
    manual_override_age_modes: z.array(z.enum(AGE_MODES)),
    element_thresholds: z.object({
      avatar_and_space: z.number(), achievement_badges: z.number(), celebration_subtle: z.number(), xp_number_and_level_bar: z.number(), celebration_full: z.number(),
      collectibles_and_unlocks: z.object({ min_intensity: z.number(), allowed_stages: z.array(z.number().int()) }),
    }),
    never_hidden: z.array(z.string()),
  }),
  avatar: z.object({ training_level_points: z.object({ simulated: z.number(), guided_real: z.number(), independent_real: z.number(), transfer: z.number(), mastered: z.number() }), stage_thresholds: z.array(z.number()) }),
  comeback: z.object({ min_gap_days: z.number(), reflect_within_hours: z.number() }),
  achievements: z.object({
    comeback: z.object({ tiers: z.array(z.number().int()) }),
    mindful_abandon: z.object({ capability: z.enum(CAPABILITY_IDS), min_reflection_value: z.number() }),
    new_context: z.object({ min_value: z.number(), per_capability: z.boolean() }),
    play_less: z.object({ evaluate_every_days: z.number().int(), min_stage: z.number().int(), window_days: z.number().int(), min_active_days_drop_ratio: z.number(), min_worked_transfer_reports: z.number().int(), max_capability_drop_points: z.number(), require_all_mastery_checks_passed: z.boolean() }),
  }),
  xp: z.object({
    rewards: z.object({
      gate1_pass: z.object({ base: z.number(), per_difficulty_above_1: z.number() }),
      gate2_shown: z.number(), gate2_partial: z.number(), gate2_not_yet: z.number(), reflection_done: z.number(),
      transfer_report: z.number(), transfer_guardian_confirmed: z.number(), comeback: z.number(), mastery_check_pass: z.number(),
    }),
    fading: z.object({ gate1_zero_when: z.object({ min_stage: z.number().int(), primary_capability_support_level: z.enum(SUPPORT_LEVELS) }), simulated_zero_from_stage: z.number().int() }),
    daily_cap: z.number(),
    level_formula: z.string(),
    step_rewards: z.object({
      step_planned: z.number().int().nonnegative(), step_prediction: z.number().int().nonnegative(), step_resumed: z.number().int().nonnegative(),
      step_distraction_handled: z.object({ per_event: z.number().int().nonnegative(), max_per_mission: z.number().int().nonnegative() }),
      stop_when: z.object({ primary_support_level: z.enum(SUPPORT_LEVELS), or_mastered: z.boolean() }),
    }),
  }),
  challenges: z.object({
    min_participants: z.number().int().positive(), max_participants: z.number().int().positive(), duration_days: z.number().int().positive(), start_window_hours: z.number().int().positive(),
    fairness: z.object({ same_age_mode: z.boolean(), same_training_level: z.boolean(), max_support_level_gap: z.number().int().nonnegative(), fixed_difficulty: z.boolean() }),
    min_intensity: z.number().int().nonnegative(), auto_match_age_modes: z.array(z.enum(AGE_MODES)), child_requires_guardian_approval: z.boolean(),
    scoring: z.object({ attempts_per_reflected: z.number(), attempts_daily_cap: z.number().int(), attempts_total_cap: z.number().int(), shown: z.number(), partial: z.number(), transfer_confirmed: z.number(), transfer_self: z.number(), transfer_cap: z.number().int(), improvement_factor: z.number(), improvement_max: z.number() }),
    badges: z.array(z.string()), forbidden: z.array(z.string()),
  }),
  surprises: z.object({
    probability_by_stage: z.object({ "1": z.number(), "2": z.number(), "3": z.number(), "4": z.number() }),
    kinds: z.object({ cosmetic: z.number(), xp_bonus: z.number(), encouragement: z.number() }),
    xp_bonus_range: z.tuple([z.number().int(), z.number().int()]), daily_cap: z.number().int(), weekly_cap: z.number().int(), min_intensity: z.number().int(), forbidden: z.array(z.string()),
  }),
}).passthrough();
const aiFn = z.object({ model: z.enum(["main", "light"]), max_output_tokens: z.number().int().positive(), daily_calls_per_profile: z.number().int().positive().optional(), daily_calls_global: z.number().int().positive().optional(), streaming: z.boolean() });
const aiSchema = z.object({
  config_version: z.string(),
  models: z.object({ main_env: z.string(), light_env: z.string() }),
  functions: z.object({
    goal_builder: aiFn, mission_selector: aiFn, task_classifier: aiFn, reflection_coach: aiFn, progress_narrator: aiFn,
    companion_chat: aiFn, weekly_summary: aiFn, strategy_normalizer: aiFn, adaptation_advisor: aiFn, template_drafter: aiFn,
    task_parser: aiFn, task_breakdown: aiFn, day_planner: aiFn, weekly_review: aiFn, day_reconstructor: aiFn,
  }),
  validation: z.object({ retries_on_invalid: z.number().int().nonnegative(), max_questions_per_reply: z.number().int().positive(), reflection_max_turns: z.number().int().positive() }),
  safety: z.object({ classify_inbound: z.boolean(), classify_outbound: z.boolean(), guardian_alert_max_seconds: z.number() }),
  prompt_caching: z.boolean(),
  cost_monitoring: z.object({ daily_soft_alert_usd_per_profile: z.number() }),
  model_switch_requires: z.string(),
  response_modes: z.object({
    modes: z.array(z.enum(RESPONSE_MODES)),
    moments: z.array(z.enum(MOMENTS)),
    policy: z.record(z.enum(MOMENTS), z.object({
      L0_L1: z.enum(RESPONSE_MODES), L2_L3: z.enum(RESPONSE_MODES), after_stuck: z.enum(RESPONSE_MODES).optional(),
      never_choices: z.boolean().optional(), exempt_from_budget: z.boolean().optional(), child_override: z.enum(RESPONSE_MODES).optional(),
      options_from: z.string().optional(), max_options: z.number().int().positive().optional(), optional_shortcuts_max: z.number().int().positive().optional(),
    })),
    moment_capability: z.record(z.string(), z.enum(CAPABILITY_IDS)),
    stuck_triggers: z.object({ phrases: z.array(z.string()), hesitation_seconds: z.number().positive() }),
    free_text_budget: z.object({
      per_session: z.number().int().nonnegative(), reduced: z.number().int().nonnegative(),
      reduced_when: z.object({ local_time_between: z.tuple([z.string(), z.string()]), comeback_session: z.boolean(), setting: z.string() }),
      degrade_to: z.enum(RESPONSE_MODES),
    }),
    soft_min_words: z.object({ moments: z.array(z.enum(MOMENTS)), child: z.number().int().nonnegative(), teen: z.number().int().nonnegative(), adult: z.number().int().nonnegative(), follow_up_once: z.boolean() }),
    options: z.object({
      min: z.number().int().positive(), max: z.number().int().positive(), max_chars: z.number().int().positive(),
      source_priority: z.array(z.enum(OPTION_SOURCES)), require_user_words_when_available: z.boolean(), other_button_added_by_ui: z.boolean(), fallback_file: z.string(),
    }),
    evidence: z.object({ reflection_quality_only_from: z.literal("free_text"), choice_answers_negative: z.boolean() }),
    session_kinds_extra: z.array(z.string()),
  }),
});
const limitsSchema = z.object({
  config_version: z.string(),
  goal_max_depth: z.number().int().positive(),
  onboarding_simulated_missions: z.number().int().positive(),
  onboarding_mission_max_minutes: z.number().int().positive(),
  engine: z.object({
    mechanic_diversity_lookback_days: z.number().int().nonnegative(),
    candidate_pool_min: z.number().int().positive(),
  }),
  reflection: z.object({ min_answer_chars: z.number().int().nonnegative() }),
  distraction: z.object({ first_at_fraction: z.number(), spread_fraction: z.number() }),
  narrative: z.object({ accurate_max_relative_error: z.number() }),
  chat: z.object({ handoff_release_minutes: z.number().int().positive(), context_messages: z.number().int().positive(), transfer_invite_days: z.array(z.number().int()) }),
  offline: z.object({
    sync_batch_max: z.number().int().positive(), retry_backoff_ms: z.array(z.number().int().positive()).min(1), max_attempts: z.number().int().positive(),
    flush_interval_ms: z.number().int().positive(), client_at_max_age_days: z.number().int().positive(), cached_missions_max: z.number().int().positive(),
  }),
  notifications: z.object({
    hard_cap_per_day: z.number().int().positive(), tick_minutes: z.number().int().positive(), planner_lookahead_hours: z.number().int().positive(),
    bypass_types: z.array(z.string()), types_in_cap: z.array(z.string()),
    comeback_after_gap_days: z.number().int().positive(), comeback_repeat_days: z.number().int().positive(), mastery_check_lead_days: z.number().int().nonnegative(),
    retention_days: z.number().int().positive(), push_ttl_seconds: z.number().int().positive(), timer_notification_lead_seconds: z.number().int().nonnegative(),
  }),
});

export const customization = customizationSchema.parse(customizationJson);
export const support = supportSchema.parse(supportJson);
export const scoring = scoringSchema.parse(scoringJson);
export const game = gameSchema.parse(gameJson);
export const ai = aiSchema.parse(aiJson);
export const limits = limitsSchema.parse(limitsJson);
const trialSchema = z.object({
  config_version: z.string(),
  cohort: z.object({ min_users: z.number().int(), max_users: z.number().int(), weeks: z.number().int().positive(), enabled_age_modes: z.array(z.enum(AGE_MODES)).min(1), min_users_per_enabled_mode: z.number().int(), snapshot_every_days: z.number().int().positive() }),
  metrics: z.object({
    skill_growth: z.object({ min_missions: z.number().int(), min_capabilities_improved: z.number().int(), compare_weeks: z.tuple([z.number().int(), z.number().int()]), min_share_of_qualifying_users: z.number() }),
    transfer_rate: z.object({ target: z.number() }),
    autonomy: z.object({ min_support_levels_up: z.number().int(), min_share_of_users: z.number() }),
    mastery_over_achievement: z.object({ compare_weeks: z.tuple([z.number().int(), z.number().int()]) }),
    novel_context: z.object({ max_relative_gap: z.number() }),
    healthy_return: z.object({ after_days: z.array(z.number().int()), targets: z.record(z.string(), z.number()) }),
    adaptation_acceptance: z.object({ target: z.number() }),
  }),
  counter_warnings: z.object({
    xp_without_learning: z.object({ min_xp_growth_ratio: z.number(), max_avg_capability_delta: z.number() }),
    reward_displaces_motivation: z.object({ window_days: z.number().int(), min_shown_rate_drop: z.number(), min_missions_each_window: z.number().int() }),
  }),
  analytics: z.object({ events: z.array(z.string()), allowed_props: z.array(z.string()), max_string_prop_length: z.number().int(), profile_hash_length: z.number().int(), retention_days: z.number().int() }),
  readiness: z.object({ required_env: z.array(z.string()), optional_env: z.array(z.string()), require_safety_resources_verified: z.boolean(), min_active_templates: z.number().int() }),
});
export const trial = trialSchema.parse(trialJson);
/** المخطط (0.4 ب): الشكل الكامل يُتحقق منه في المرحلة 9؛ هنا يُتحقق من الإصدار فقط ليدخل في CONFIG_VERSION. */
export const planner = z.object({ config_version: z.string() }).passthrough().parse(plannerJson) as { config_version: string } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type SettingKey = keyof typeof customizationJson.catalog;
export const SETTING_KEYS = Object.keys(customization.catalog) as SettingKey[];

/** إصدار الإعدادات المركب: يُحفظ في سجل التدقيق وفي الأدلة لاحقًا (MAP-5). */
export const CONFIG_VERSION = [
  `scoring:${scoring.config_version}`,
  `support:${support.config_version}`,
  `game:${game.config_version}`,
  `customization:${customization.config_version}`,
  `ai:${ai.config_version}`,
  `limits:${limits.config_version}`,
  `trial:${trial.config_version}`,
  `planner:${planner.config_version}`,
].join("|");

export function catalogEntry(key: string): CatalogEntry | undefined {
  return customization.catalog[key];
}
