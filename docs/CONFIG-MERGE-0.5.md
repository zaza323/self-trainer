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


## إضافات محلية في المرحلة 12
- `config/ai.json` → `ai_off.auto_degrade` (جديد، غير موجود في 0.5): `window_minutes = 10`، `provider_errors_threshold = 5`، `recover_after_minutes = 15`، `daily_global_calls_budget = 5000`، `timeout_ms = 20000`. CHANGE-0.5 يذكر «بعد المدة المحددة» ولا يحدد القيم.

## ملاحظات ترقيم الهجرات
CHANGE-0.5 يقول «الهجرات الجديدة تبدأ من 0017» و«0017 سجل الحياة · 0018 الاقتراحات · 0019 الهامش». لكن 0017 استُخدمت لإغلاق الكتابة المباشرة (بنود الخطوة A)، و0018 للصلاحية `set_task_margin` (لازمة لدمج `permissions_all`). الترقيم الفعلي: 0019 سجل الحياة (المرحلة 13)، 0020 الهامش (المرحلة 14). لم تلزم هجرة لتعميم جدول الاقتراحات (انظر VERIFY-LATER).

## التعارضات الثمانية بالتفصيل

| # | الملف | المفتاح | القيمة المحلية | قيمة 0.5 | المعتمد |
|---|---|---|---|---|---|
| 1 | `ai.json` | `config_version` | "2026-11-05.4" | "2026-11-09.5" | 0.5 |
| 2 | `ai.json` | `response_modes.moments` | 12 عنصرًا | 17 عنصرًا؛ أُضيف: life_roles, life_responsibilities, life_dependents, life_pressure, life_refresh؛ حُذف: — | 0.5 |
| 3 | `ai.json` | `response_modes.session_kinds_extra` | 1 عنصرًا | 2 عنصرًا؛ أُضيف: life_intake؛ حُذف: — | 0.5 |
| 4 | `customization.json` | `config_version` | "2026-11-05.4" | "2026-11-09.5" | 0.5 |
| 5 | `customization.json` | `guardrails_not_configurable` | 20 عنصرًا | 23 عنصرًا؛ أُضيف: ai_decides_nothing, scenarios_from_user_life_only, margin_never_penalizes, margin_not_in_evidence؛ حُذف: notification_hard_cap_3 | 0.5 |
| 6 | `customization.json` | `personal_context.fields` | 4 عنصرًا | 8 عنصرًا؛ أُضيف: roles, responsibilities, dependents, pressures؛ حُذف: — | 0.5 |
| 7 | `customization.json` | `personal_context.forbidden_content` | 3 عنصرًا | 5 عنصرًا؛ أُضيف: income, religion_practices_assumed؛ حُذف: — | 0.5 |
| 8 | `customization.json` | `permissions_all` | 10 عنصرًا | 11 عنصرًا؛ أُضيف: set_task_margin؛ حُذف: — | 0.5 |

- كل التعارضات إضافات على قوائم أو رقم الإصدار. الحذف الوحيد: `notification_hard_cap_3` من الحواجز، وهو متوافق مع 0.4 (السقف صار حسب الوضع العمري `notification_adaptive_ceiling`).
- لم يمس الدمج `config/planner.json`: قيم الوتيرة المعدّلة بطلب المالك سليمة ومقفولة باختبار `src/modules/pace/cap.test.ts` ← «قيم الوتيرة المعتمدة لا ترجع لقيم قديمة»: سقف ناعم 50%، اكتشاف 28 يومًا أو 14 يوم نشاط (أيهما أبعد)، سقف الطفل صارم/ليّن بافتراضي صارم، وحدة واحدة مسموحة دائمًا، واقتراح الزيادة 10%.
