# دمج إعدادات 0.5

القاعدة: لا كتابة فوق الملفات. المفتاح الجديد يُضاف، والمفتاح المحلي غير الموجود في نسخة 0.5 يبقى، وعند تعارض القيم تُعتمد قيمة 0.5 ويُسجَّل التعارض هنا.

- `config/margins.json`: **جديد**، نُسخ كما هو.
- `config/scoring.json` و`support.json` و`game.json` و`planner.json`: لا تغيير في 0.5 (CHANGE-0.5 «ما لا يتغيّر»)؛ النسخ المرفقة بإصدار `2026-11-05.4` قديمة ولم تُستخدم.

## `config/ai.json`

### تعارضات (اعتُمدت قيمة 0.5) (3)
- `config_version`: "2026-11-05.4" ← "2026-11-09.5"
- `response_modes.moments`: ["confirm", "logistics", "feeling_check", "strategy_choice", "goal_why", "goal_what", "reflection_core", "reflection_sec ← ["confirm", "logistics", "feeling_check", "strategy_choice", "goal_why", "goal_what", "reflection_core", "reflection_sec
- `response_modes.session_kinds_extra`: ["mirror"] ← ["mirror", "life_intake"]

### مفاتيح جديدة من 0.5 (11)
- `functions.life_intake_assistant`
- `response_modes.policy.life_roles`
- `response_modes.policy.life_responsibilities`
- `response_modes.policy.life_dependents`
- `response_modes.policy.life_pressure`
- `response_modes.policy.life_refresh`
- `response_modes.evidence.life_moments_produce_evidence`
- `life_intake`
- `boundary`
- `ai_off`
- `text_guard`

### مفاتيح محلية أُبقيت (غير موجودة في 0.5) (0)

## `config/customization.json`

### تعارضات (اعتُمدت قيمة 0.5) (5)
- `config_version`: "2026-11-05.4" ← "2026-11-09.5"
- `guardrails_not_configurable`: ["public_leaderboards", "streak_threats", "loss_counters", "paid_rewards", "notification_adaptive_ceiling", "child_requi ← ["public_leaderboards", "streak_threats", "loss_counters", "paid_rewards", "notification_adaptive_ceiling", "child_requi
- `personal_context.fields`: ["interests", "routine", "free_windows", "contexts"] ← ["interests", "routine", "free_windows", "contexts", "roles", "responsibilities", "dependents", "pressures"]
- `personal_context.forbidden_content`: ["health", "non_family_person_names", "precise_locations"] ← ["health", "non_family_person_names", "precise_locations", "income", "religion_practices_assumed"]
- `permissions_all`: ["view_progress", "view_chat", "intervene_chat", "add_missions", "receive_alerts", "manage_guardians", "add_rewards", "m ← ["view_progress", "view_chat", "intervene_chat", "add_missions", "receive_alerts", "manage_guardians", "add_rewards", "m

### مفاتيح جديدة من 0.5 (14)
- `catalog.margin_history_mode`
- `catalog.life_refresh_days`
- `catalog.share_life_log_with_guardians`
- `adaptation.allowed_types.margin_adjustment`
- `personal_context.item_shape`
- `personal_context.dependents_store`
- `personal_context.intake`
- `personal_context.refresh`
- `personal_context.visibility`
- `personal_context.blocklist_file`
- `personal_context.scenario_sources_priority`
- `personal_context.scenario_text_composition`
- `permission_defaults.set_task_margin`
- `permission_scopes`

### مفاتيح محلية أُبقيت (غير موجودة في 0.5) (2)
- `catalog.notification_max_per_day.max`
- `catalog.pace_cap_mode`

