# دمج config لتعديل 0.4 (الإصدار `2026-11-05.4`)

القاعدة: القيمة الجديدة تغلب عند التعارض، والمفتاح المحلي غير الموجود في الجديد يبقى، والمصفوفات تُوحَّد (ترتيب الجديد ثم الإضافات المحلية).

## التعارضات (اعتُمد الجديد)
| الملف | المفتاح | المحلي | الجديد | الأثر |
|---|---|---|---|---|
| الكل | `config_version` | .1/.2/.3 | `2026-11-05.4` | — |
| game | `challenges.badges` | كائن `{most_improved: "improvement_pts", most_persistent: "reflected_count"}` | مصفوفة `["biggest_improvement","most_persistent"]` | معرّف الوسام صار `biggest_improvement` في الكود والمحتوى والاختبار؛ ربط الوسام بمقياسه صار في كود `challenges/scoring.ts` لا في config |
| customization | `catalog.notification_max_per_day` | `int` بافتراضي 1 | `int_or_auto` بافتراضي `"auto"` | `"auto"` مؤقتًا = `planner.engagement.budget.low` (1/1/1) فيبقى سلوك 0.3؛ يُستبدل بحالات التفاعل في الخطوة 3 (الجزء و) |

## مفاتيح محلية بقيت (غير موجودة في الجديد)
- scoring: `value_defaults.transfer_report`, `value_defaults.guardian_observation`
- customization: `guardrails_not_configurable` ⟸ `notification_hard_cap_3` (أُضيف إلى مصفوفة الجديد)
- game: `challenges.fairness / scoring.* (الأسماء القديمة) / start_window_hours / min_intensity / child_requires_guardian_approval / forbidden / _note`، `surprises.daily_cap / weekly_cap / min_intensity / forbidden / _note`، `xp.step_rewards`

## مفاتيح مكررة بأسماء مختلفة (القيم متطابقة، الكود يقرأ القديم)
`challenges.scoring` (`attempts_per_reflected` ↔ `attempt_points` …)، `challenges.fairness` ↔ `matching`، `surprises.daily_cap` ↔ `max_per_day`، `xp.step_rewards` ↔ `xp.step_rules`. لم أوحّدها لأن توحيدها يمس منطق 0.3 المختبر؛ مرشّحة للتوحيد في خطوة لاحقة.

## ملفات جديدة
`config/planner.json` (يُتحقق منه بالكامل في الخطوة 2؛ الآن يُتحقق من `config_version` فقط ويدخل في `CONFIG_VERSION`).

## إضافات محلية في الخطوة 2 (المرحلة 9)
- `config/planner.json`: `nlp.period_hours` (ساعة كل كلمة فترة في المحلّل)، `tasks.recurrence.default_recur_from` («كل N أيام» من الإنجاز افتراضيًا كما في مثال ب.4)، `reminders.tick_lookahead_min`.
- `config/limits.json`: `notifications.user_set_types = ["planner_reminder"]` (ب.5: تذكيرات المستخدم خارج الحد اليومي؛ تحترم الهدوء إلا «مهم»)، والإصدار `2026-11-05.4`.

## إضافات محلية في الخطوة 3 (المرحلة 10)
- `config/planner.json`: `daily_moments.moments.muhasaba.m2_value = 0.6` (ز.5 M2).
- `config/limits.json`: `notifications.types_in_cap` += `daily_moment, followup_push, away_checkin, busy_bundle, daily_moments_fade`؛ `hard_cap_per_day` 3 → 6 (السقف الفعلي حسب الوضع في `planner.engagement.ceiling`).
- `config/game.json`: المخطط Zod الآن يشمل `xp.planner_rules` وكل أسباب XP الجديدة وإنجازات `first_full_week` / `habit_7_days` / `restful_week` / `pace_rising`.

## إضافات محلية في الخطوة 4 (المرحلة 11)
كلها مفاتيح جديدة لم تكن في ملفات 0.4، أُضيفت لأن «لا أرقام في الكود». لا تعارض قيم في هذه الخطوة.
- `config/planner.json` → `pace`: `self_compare_tolerance = 0.05` (هامش «ثابت» في المقارنة بالنفس)، `hard_week_low_days = 3` (أيام حالة low في الأسبوع ⇒ اقتراح hold)، `evaluation_window_days = 7`، `new_habit_window_days = 56`، `lookback_days = 28`، `self_compare_days_ago = 28`.
- `config/planner.json` → `evidence_bridge.convert_to_mission`: `default_mechanic = "decompose"`، `default_minutes = 20`، `independent_from_training_levels = ["independent_real", "transfer"]`.
- `config/planner.json` → `ai.day_planner.defaults`: `day_end = "22:00"`، `default_estimate_min = 25`، `buffer_min = 5`؛ و`ai.task_parser.merge = "deterministic_matched_wins"`.
- `config/planner.json` → `reality_mirror.triggers.monthly_days = 30`.
- `config/limits.json` → `notifications.types_in_cap` += `mirror_suggestion`.

## تعديل بطلب المالك: سقف الزيادة على مرحلتين
- `config/planner.json` → `pace`: حُذف `max_over_baseline_percent = 25`، وأُضيف `pace.cap` = { `discovery`: { `min_days`: 28، `min_active_days`: 14 }، `soft_over_baseline_percent`: 50، `overreach_pattern`: { `times`: 3، `achieved_ratio_below`: 0.5 }، `modes`: [hard, soft]، `child_default_mode`: hard }. `stretch_default_percent` باقٍ 10.
- `config/customization.json` → `catalog.pace_cap_mode` (enum hard/soft، للطفل فقط، الافتراضي hard للطفل).
- تعارض مع CHANGE-0.4 ح.4/ح.9-8 («لا تتجاوز 25%» و«السقف يغلب الحد الأدنى»): حُسم لصالح طلب المالك (50% ناعم، والوحدة تغلب السقف).
