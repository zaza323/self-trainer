# تعديل 0.3: نقاط الخطوات، التحديات العادلة، المفاجآت

**لـ Claude Code:** هذا تعديل على مشروع قائم مبني على PRD v0.2. طبّقه كما هو، دون إعادة بناء ما يعمل. المرجع الكامل بعد التعديل: `docs/PRD-v0.3.md` والملحق (أ) الأقسام أ.8 وأ.13 وأ.14، والقيم في `config/game.json` و`config/customization.json` (الإصدار `2026-11-05.3`).

## 1. نقاط الخطوات أثناء التدريب

**قبل:** لا نقاط على الخطوات، النقاط على النتائج فقط.
**بعد:** نقاط على الخطوات ما دامت القدرة الأساسية للمهمة قيد التدريب.

| السبب (`reason`) | XP | الشرط |
|---|---|---|
| `step_planned` | 3 | اختار استراتيجية وقدّر الوقت |
| `step_prediction` | 2 | أجاب سؤال التوقع |
| `step_resumed` | 3 | عاد بعد انقطاع |
| `step_distraction_handled` | 2 | لكل مشتت تجاهله أو عاد منه، بحد أقصى 2 لكل مهمة |

- تُمنح عند `reflected` فقط، وتدخل `xp_events` بقيد `UNIQUE(reason, source_id)` حيث `source_id = mission_id` (و`mission_id:n` لخطوات المشتت).
- **تتوقف** إذا كان دعم القدرة الأساسية `L3_free` أو كانت متقنة.
- ضمن السقف اليومي 150 XP.

## 2. التحديات العادلة

تحدٍّ = 2–6 متدربين على **قالب مهمة واحد**، 7 أيام، يبدؤون خلال نافذة 48 ساعة.

**التكافؤ (يرفض الخادم الانضمام عند الإخلال):** نفس `age_mode`، نفس `training_level` للقدرة الأساسية للقالب، فرق مستوى الدعم ≤ 1، الصعوبة مثبتة للتحدي.

**الانضمام:** اختياري دائمًا، بدعوة (رمز) أو مطابقة تلقائية (teen وadult فقط ولمن فعّلها). child: بدعوة فقط + موافقة مربٍ.

**نقاط التحدي** (منفصلة عن XP، من الأدلة فقط، على مهام قالب التحدي داخل نافذته):

```
attempts_pts    = 4 × مهام reflected (حد 2 يوميًا، 10 إجمالًا)
shown_pts       = 12 × shown + 4 × partial
transfer_pts    = 15 × نقل مؤكد من مربٍ + 7 × نقل ذاتي (حد 4)
improvement_pts = clamp(round(2 × (score_end − score_start)), 0, 30)
total           = المجموع؛ التعادل يتقاسم المرتبة
```

- أوسمة: "أكبر تحسن" (أعلى improvement_pts)، "أكثر مثابرة" (أكثر مهام reflected).
- لوحة يراها المشاركون فقط بأسماء العرض. **ممنوع:** لوحة عامة، محادثة بين المشاركين، إشعار "فلان تجاوزك"، خصم نقاط، عقوبة انسحاب.
- تظهر إذا الكثافة ≥ 30 والإعداد `challenges_enabled` مفعّل.

**جداول جديدة:**

```
challenges             id, template_id, template_version, difficulty, capability_id, training_level, age_mode,
                       starts_at, ends_at, status (open|active|finished|cancelled), created_by, invite_code
challenge_participants challenge_id, profile_id, display_name, support_level_at_join, score_start,
                       joined_at, left_at, approved_by_guardian_id   PRIMARY KEY (challenge_id, profile_id)
challenge_scores       challenge_id, profile_id, attempts_pts, shown_pts, transfer_pts, improvement_pts,
                       total, rank, badges text[], computed_at
```

RLS: المشارك يرى صفوف تحدياته فقط؛ المربي يرى تحديات متدربه.

## 3. المفاجآت العشوائية

- بعد كل `reflected`: احتمال مفاجأة مجانية حسب المرحلة `{1: 10%, 2: 6%, 3: 3%, 4: 0%}`.
- الأنواع: تزيين للمساحة 50%، نقاط إضافية 5–10 ضمن السقف اليومي 30%، رسالة تشجيع 20%.
- حدود: 1 يوميًا، 3 أسبوعيًا. لا تظهر إذا الكثافة < 10 أو `surprises_enabled = false`.
- **مولّد عشوائي حتمي ببذرة `mission_id`**، حتى تعطي إعادة الحساب النتيجة نفسها.
- ممنوع: الشراء، الربط بسلسلة أيام، عرض الاحتمالات كرهان.

```
surprise_events        id, profile_id, mission_id, kind (cosmetic|xp_bonus|encouragement), payload jsonb,
                       rng_seed, created_at          -- append-only, UNIQUE(mission_id)
```

## 4. إعدادات جديدة (`config/customization.json`)

| المفتاح | النوع | الافتراضي child / teen / adult |
|---|---|---|
| `challenges_enabled` | bool | false / true / true |
| `challenge_auto_match` | bool (teen وadult فقط) | false / false / false |
| `surprises_enabled` | bool | true / true / true |

الحواجز: `leaderboards` ← `public_leaderboards`، `paid_random_rewards` ← `paid_rewards`، وإضافة `challenge_fairness_matching` و`surprise_caps`.

## 5. شاشات جديدة
- **P21** التحديات: الانضمام، المطابقة، الدعوة برمز.
- **P22** لوحة التحدي ونتيجته مع الأوسمة.
- **G13** موافقة المربي على تحديات الطفل.

## 6. اختبارات قبول
1. قدرة دعمها L3 → صفر نقاط خطوات، ونقاط النتائج كما هي.
2. متدرب بمستوى تدريب مختلف أو فرق دعم > 1 → الانضمام مرفوض.
3. 5 محاولات في يوم واحد → تُحتسب 2 فقط في `attempts_pts`.
4. إعادة الحساب تعطي المفاجآت نفسها حرفيًا.
5. مستخدم بالمرحلة 4 → لا مفاجآت.
6. child بلا موافقة مربٍ → لا يدخل أي تحدٍّ.
7. كل اختبارات الملحق أ.11 السابقة ما زالت تمر.
