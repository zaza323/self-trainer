# ملحق (أ): المعادلات، القيم الافتراضية، ومخطط الأدلة

يكمّل ملف المتطلبات **v0.4** (`docs/PRD-v0.4.md`). **في المعادلات والقيم عند التعارض يُعتمد هذا الملحق؛ في كل ما عداها يُعتمد الملف الرئيسي.**
القيم الرقمية مرجعها ملفات `config/*.json`؛ الأرقام هنا للتوضيح ويجب أن تطابقها. أي تغيير في المعادلات يرفع `config_version` ويستدعي إعادة الحساب (MAP-5).

---

## أ.0 حالة التصحيحات

كل تصحيحات v0.1 (الترقيم، ترتيب GOAL، المخططات المقطوعة، توحيد `profile_id`، إضافات نموذج البيانات) **مطبّقة منذ v0.2**. المرجع للترقيم ونموذج البيانات هو الملف الرئيسي (القسم 11).

---

## أ.1 مخططات الذكاء الاصطناعي المكتملة

### أنواع مشتركة

```ts
type CapabilityId =
  | "self_awareness" | "motive_awareness" | "self_control" | "attention"
  | "thinking" | "perseverance" | "planning" | "autonomy";

type ThinkingMove =
  | "decompose"          // تقسيم الهدف
  | "clarify_motive"     // توضيح الدافع ("لماذا؟")
  | "concretize"         // تحويل الأمنية إلى سلوك ملموس
  | "prioritize"         // اختيار الأولوية
  | "estimate_time"      // تقدير الوقت
  | "anticipate_obstacle"// توقع العقبة
  | "reframe";           // إعادة صياغة الموقف

type Safety = {
  flag: boolean;
  category: "self_harm" | "abuse" | "immediate_danger" | "age_inappropriate" | null;
  severity: "low" | "medium" | "high" | null;
};
```

### goal_builder — المخرج في كل دور

```ts
{
  next_question: string | null;          // سؤال واحد فقط. null عند phase = "done"
  reflection_of_user_words: string;      // إعادة كلمات المستخدم كما قالها، بلا تلخيص
  thinking_move_named: ThinkingMove | null; // يُسمّى فقط بعد أن يحدث فعلًا في الدور السابق
  phase: "explore" | "climb_why" | "descend_how" | "confirm" | "done";
  draft: {
    goals: Array<{
      temp_id: string;
      parent_temp_id: string | null;     // null = الجذر الحالي
      title_user_words: string;
      why_user_words: string | null;
    }>;
    first_step_user_words: string | null;
  };
  needs_user_confirmation: boolean;      // true = الواجهة تعرض المسودة للتعديل والتأكيد
  safety: Safety;
}
```

**قواعد الخادم بعد التحقق:**
- لا تُحفظ أي غاية في `goals` إلا بعد ضغط المستخدم "تأكيد" على المسودة (AI-16). ما يُحفظ هو نص المسودة بعد تعديل المستخدم، لا مخرج النموذج.
- `next_question` يُرفض إذا احتوى أكثر من علامة استفهام واحدة (`؟` أو `?`) → إعادة محاولة مرة → ثم سؤال ثابت من ملف المحتوى.
- عمق الشجرة بعد الدمج ≤ 12، ومنع الدورات.

### reflection_coach — المخرج في كل دور

```ts
{
  next_question: string | null;          // سؤال واحد. null عند done = true
  done: boolean;                         // حد أقصى 4 أدوار، ثم done إجباريًا من الخادم
  reflection_summary_user_words: string | null; // عند done فقط، من كلمات المستخدم
  thinking_move_named: ThinkingMove | null;
  custom_strategy_fit: number | null;    // −1..1، فقط إذا كتب المستخدم استراتيجية خاصة
  evidence_candidates: Array<{
    capability_id: CapabilityId;
    type: "reflection_quality";
    value: number;                       // −1..1
    rationale: string;                   // جملة واحدة، للمراجعة لا للعرض
  }>;                                    // حد أقصى 3
  safety: Safety;
}
```

**قواعد الخادم:** المرشحات تُقبل فقط لقدرات القالب + `self_awareness` + `thinking`. القيم تُقص إلى [−1, 1]. الذكاء الاصطناعي **لا** يقرر البوابة الثانية؛ المحرك يحسبها (أ.4).

---

## أ.2 مخطط `evidence_rules`

### متى تُقيَّم القواعد
- كل قواعد المهمة تُقيَّم **دفعة واحدة عند الانتقال إلى `reflected`** (لا أدلة إتقان قبل التأمل).
- قواعد النقل تُقيَّم عند `transferred`.
- `guardian_observation` و`companion_insight` تُكتب خارج المهام (`mission_id = null`).

### البنية

```ts
type EvidenceRule = {
  id: string;
  type: EvidenceType;              // من جدول 4.7
  capability_id: CapabilityId;
  source: "auto" | "ai" | "self" | "guardian";
  rule_weight?: number;            // افتراضي 1.0
  value: ValueSpec;
};

type ValueSpec =
  | { kind: "choice_map"; field: "distraction_log"; aggregate: "mean";
      map: Record<"ignore" | "break_return" | "give_in", number> }
  | { kind: "strategy_fit" }                      // من strategies[].fit، أو custom_strategy_fit إن كانت مخصصة (والمصدر يصبح ai)
  | { kind: "prediction_error"; tolerance: number }
  | { kind: "hint_count"; map: { "0": number; "1": number; "2+": number } }
  | { kind: "recovery" }
  | { kind: "ai_candidate" }                      // من evidence_candidates
  | { kind: "mirror" };                           // متوسط أدلة القدرة نفسها في المهمة
```

### دوال القيم

| النوع | المعادلة |
|---|---|
| `choice_map` | متوسط قيم الخيارات في `distraction_log`. الافتراضي: تجاهل +1.0، استراحة وعودة +0.6، استسلام −0.4 |
| `strategy_fit` | قيمة `fit` للاستراتيجية المختارة من القالب (يكتبها المشرف لكل استراتيجية). إن كانت مخصصة: `custom_strategy_fit` والمصدر `ai` |
| `prediction_error` | `rel = |فعلي − متوقع| / متوقع` ثم `value = clamp(1 − 2·rel/tolerance, −1, 1)`. الافتراضي `tolerance = 1.0`: خطأ 0% → +1، 25% → +0.5، 50% → 0، 100% → −1 |
| `hint_count` | 0 تلميح → +1.0، تلميح واحد → +0.3، اثنان فأكثر → −0.3 |
| `recovery` | انقطع ثم أكمل → +1.0؛ انقطع ثم تخلى بعد تأمل → +0.3؛ لم ينقطع → لا دليل |
| `mirror` | متوسط قيم أدلة القدرة نفسها في المهمة؛ إن لم يوجد → لا دليل |

### القواعد العامة (يطبقها المحرك على كل مهمة، لا تُكتب في القالب)

| المعرّف | النوع | القدرة | الشرط | القيمة | rule_weight |
|---|---|---|---|---|---|
| G1 | `recovery` | perseverance | وُجد انتقال `interrupted` | `recovery` | 1.0 |
| G2 | `help_needed` | autonomy | مستوى الدعم ≥ L1 (في L0 التعليمات معروضة أصلًا فلا يُقاس) | `hint_count` | 0.5 |
| G3 | `novel_context` | القدرة الأساسية للقالب | `training_level ≠ simulated` ولا يوجد دليل سابق لهذه القدرة بنفس `context_tag` | `mirror` | 1.0 |
| G4 | `reflection_quality` | حسب كل مرشح | وُجد `evidence_candidates` | `ai_candidate` | 1.0 |

قيد التفرد `(mission_id, capability_id, type)` يمنع أي تكرار: إذا كتب القالب قاعدة بنفس الثلاثي، تتغلب قاعدة القالب على العامة.

### الوزن النهائي للدليل

```
weight = source_weight[source] × support_multiplier[support_level] × rule_weight
```

| المصدر | الوزن | | مستوى الدعم | المضاعف |
|---|---|---|---|---|
| auto | 1.0 | | L0_instruct | 0.6 |
| guardian | 0.9 | | L1_hint | 0.8 |
| ai | 0.6 | | L2_ask | 1.0 |
| self | 0.4 | | L3_free | 1.0 |
| companion | 0.3 | | | |

**لماذا مضاعف الدعم:** ما يُنجز بتعليمات كاملة دليل أضعف على القدرة المستقلة.
**إعادة الحساب:** يُحفظ `source` و`support_level` و`rule_weight` في كل حدث؛ عمود `weight` لقطة للعرض، وإعادة الحساب تشتقه من جديد بالإعدادات الحالية.

---

## أ.3 درجة القدرة والثقة

لكل قدرة `c` ومستخدم، عند اللحظة `t`:

```
decay_i      = 0.5 ^ (age_days_i / 21)                 // نصف عمر الدليل 21 يومًا
w'_i         = weight_i × decay_i
mass         = Σ w'_i
raw          = Σ (w'_i × value_i) / (mass + K)          // K = 2: انكماش نحو الصفر عند قلة الأدلة
score_pct    = round((raw + 1) / 2 × 100)               // 0..100، و50 = محايد

n_ctx        = عدد السياقات التي مجموع w' فيها ≥ 0.3
conf_mass    = 1 − e^(−mass / 4)
conf_ctx     = min(1, n_ctx / 3)
confidence   = conf_mass × (0.5 + 0.5 × conf_ctx)
```

**النتيجة المقصودة:** سياق واحد لا يتجاوز ثقة ≈ 0.67 مهما تراكمت الأدلة (تطبيق مباشر لتحذير "اختبار واحد لا يعني قوة إرادة في كل الحياة").

### نطاقات العرض

| الثقة | العرض |
|---|---|
| < 0.35 | "لا نعرف بعد" — لا تُعرض النسبة |
| 0.35 – 0.65 | النسبة + "مبدئي" |
| > 0.65 | النسبة + العبارة التفسيرية كاملة |

| الدرجة | نطاق العبارة |
|---|---|
| < 35 | تحتاج دعمًا |
| 35 – 65 | تنمو |
| > 65 | قوية |

نصوص العبارات (نطاق × قدرة × وضع عمري) في ملف محتوى `content/phrases.ar.json`، لا في الكود.

**الانخفاض (MAP-4):** يُعرض عندما تنخفض الدرجة ≥ 10 نقاط عن لقطة قبل 14 يومًا، والثقة في الطرفين ≥ 0.35.

### مثال محسوب (الانتباه)

| # | القيمة | الوزن | العمر (يوم) | السياق | w' |
|---|---|---|---|---|---|
| 1 | −0.4 | 0.6 (auto, L0) | 21 | in_app | 0.300 |
| 2 | +0.3 | 0.6 (auto, L0) | 14 | in_app | 0.378 |
| 3 | +0.6 | 0.8 (auto, L1) | 3 | study | 0.725 |
| 4 | +0.8 | 0.8 (auto, L1) | 0 | in_app | 0.800 |
| 5 | +0.8 | 0.8 (auto, L1) | 0 | in_app | 0.800 |

- قبل اليوم (1–3): mass = 1.403، raw = 0.126 → **56%**، ثقة **0.246** → يُعرض "لا نعرف بعد".
- بعد اليوم (1–5): mass = 3.003، raw = 0.341 → **67%**، ثقة **0.44** → "67% — مبدئي".

---

## أ.4 البوابتان

**البوابة الأولى (الإنجاز):** تُحسم من `completion_check`. `abandoned` = لم تُجتز.

**البوابة الثانية (الإتقان):** تُحسب بعد `reflected` من أدلة المهمة على قدرات القالب فقط (`capability_weights`):

```
G = Σ (cap_weight × weight × value) / Σ (cap_weight × weight)

shown    : G ≥ 0.5  و  عدد الأدلة ≥ 2  و  دليل واحد على الأقل مصدره auto أو guardian
partial  : G ≥ 0
not_yet  : G < 0
```

شرط المصدر يمنع أن يقرر الذكاء الاصطناعي وحده أن المهارة ظهرت.

**تعريفات ENGINE-3:**
- **نجاح سهل** = البوابة الأولى مجتازة + `shown` + صفر تلميحات.
- **تعثر** = `abandoned` أو `not_yet`.

---

## أ.5 مستويات الدعم (لكل قدرة)

**القيمة الابتدائية:** child = L0، teen = L1، adult = L1.

تُقيَّم عند كل `reflected` لمهمة وزن القدرة فيها ≥ 0.5.

| الاتجاه | الشرط |
|---|---|
| ↑ رفع مستوى | في آخر 5 مهام لهذه القدرة: `shown` ≥ 3، ومجموع التلميحات ≤ 1، ولا `abandoned`، والثقة ≥ 0.35، ومرّت ≥ 3 مهام منذ آخر تغيير |
| ↓ خفض مستوى | في آخر 3 مهام: (`not_yet` + `abandoned`) ≥ 2، ومرّت ≥ 2 مهام منذ آخر تغيير |

الحدود: L0 كحد أدنى، L3 كحد أقصى. الخفض يُعرض بعبارة "لنجرب بدعم أكثر هذه المرة".

---

## أ.6 مستويات التدريب (لكل قدرة)

"مهمة لهذه القدرة" = مهمة القدرة هي الأعلى وزنًا في قالبها.

| الانتقال | الشرط |
|---|---|
| simulated → guided_real | ≥ 3 مهام simulated بحالة `shown`، والثقة ≥ 0.35 |
| guided_real → independent_real | ≥ 3 مهام guided_real بحالة `shown`، ومستوى الدعم ≥ L2 |
| independent_real → transfer | ≥ 2 مهام independent_real بحالة `shown`، و≥ 1 تقرير نقل ناجح (`worked = true`) |
| transfer → **متقنة** (وضع 5.4) | ≥ 2 تقرير نقل ناجح في سياقين مختلفين، والدرجة ≥ 65، والثقة ≥ 0.65، والدعم = L3 |

- لا خفض تلقائي لمستوى التدريب؛ التعثر يُعالج عبر مستوى الدعم.
- **الفحص الدوري للمتقن:** كل 21 يومًا (±7 عشوائيًا)، مهمة واحدة في سياق جديد. `shown` → يبقى متقنًا. غير ذلك → `mastered = false`، والمستوى يعود إلى `independent_real`، والدعم ينخفض درجة (بحد أدنى L2).
- **المحرك يقترح** مهامًا من مستوى التدريب الحالي للقدرة، ومهمة واحدة أسبوعيًا من المستوى الأدنى للإحماء.

---

## أ.7 مراحل الحوافز وكثافة اللعبة

`avg_support` = متوسط مؤشر الدعم (L0=0 … L3=3) على القدرات **النشطة** (ثقتها ≥ 0.35). إن لم توجد → 0.

| الانتقال | الشرط |
|---|---|
| 1_attract → 2_competence | ≥ 7 أيام منذ الانضمام، و≥ 8 مهام `reflected`، و≥ 2 قدرات بثقة ≥ 0.35 |
| 2_competence → 3_meaning | `avg_support` ≥ 1.0، و≥ 1 مهمة كتبها المستخدم بنفسه وأكمل تأملها، و≥ 1 تقرير نقل |
| 3_meaning → 4_autonomy | `avg_support` ≥ 2.0، و≥ 3 قدرات بمستوى تدريب ≥ independent_real، و≥ 4 تقارير نقل خلال آخر 30 يومًا |

لا تراجع تلقائي في المرحلة.

### معادلة الكثافة

```
base       = { 1: 90, 2: 65, 3: 35, 4: 10 }[stage]
age_factor = { child: 1.0, teen: 0.85, adult: 0.6 }[age_mode]
intensity  = clamp(round((base − 5 × avg_support) × age_factor), 0, 100)
```

البالغ يستطيع تجاوزها بقيمة يدوية (`game_intensity_override`).

### ما يظهر عند كل كثافة

| العنصر | يظهر إذا الكثافة ≥ | شرط إضافي |
|---|---|---|
| الشخصية الرمزية والمساحة الشخصية | 10 | — |
| شارات الإنجازات | 10 | — |
| احتفال خفيف | 10 | — |
| رقم XP وشريط المستوى | 30 | — |
| احتفال كامل (Framer Motion) | 40 | — |
| عناصر تُجمع وفتح مناطق | 60 | المرحلة 1 أو 2 فقط |

عند كثافة 0 يختفي كل ما سبق. **شاشة الوعي بالتقدم النصية لا تختفي أبدًا**؛ هي ليست عنصرًا لعبيًا.

---

## أ.8 النقاط (XP) والشخصية الرمزية

| الحدث (`reason`) | XP |
|---|---|
| `gate1_pass` | 10 + 5 × (الصعوبة − 1) |
| `gate2_shown` | 15 |
| `gate2_partial` | 5 |
| `reflection_done` | 10 (يشمل المهام المتخلى عنها) |
| `transfer_report` | 25 |
| `transfer_guardian_confirmed` | 10 إضافية |
| `comeback` | 10 (أول مهمة `reflected` بعد انقطاع ≥ 3 أيام) |
| `mastery_check_pass` | 20 |
| `step_planned` | 3 (اختار استراتيجية وقدّر الوقت) |
| `step_prediction` | 2 (أجاب سؤال التوقع) |
| `step_resumed` | 3 (عاد بعد انقطاع) |
| `step_distraction_handled` | 2 لكل مشتت تجاهله أو عاد منه، بحد أقصى 2 لكل مهمة |

**نقاط الخطوات (جديد في 0.3):** تُمنح عند `reflected` فقط ما دامت القدرة الأساسية للمهمة دعمها < L3 وغير متقنة. عند L3 أو الإتقان تتوقف نقاط الخطوات وتبقى نقاط النتائج.

**قواعد التلاشي:**
- نقاط الخطوات = 0 إذا كان الدعم للقدرة الأساسية = L3 أو كانت متقنة (أي مرحلة).
- المرحلة ≥ 2: `gate1_pass` = 0 إذا كان الدعم للقدرة الأساسية = L3 ("المتقن لا يُكافأ على تفاصيله").
- المرحلة 4: كل XP من مهام `simulated` = 0.
- سقف يومي: 150 XP.
- **المستوى (تجميلي فقط):** المستوى n يتطلب مجموعًا تراكميًا = 50 × n × (n + 1).

**نمو الشخصية الرمزية (GAME-1)** مرتبط بالقدرات لا بالـXP:

```
avatar_points = Σ على القدرات الثماني لمؤشر مستوى التدريب
                (simulated=0, guided_real=1, independent_real=2, transfer/متقنة=3)   → 0..24
avatar_stage  = أكبر i حيث avatar_points ≥ [0, 3, 7, 12, 17, 22][i]                   → 1..6
```

---

## أ.9 الإنجازات التربوية

| الإنجاز | القاعدة | التكرار |
|---|---|---|
| عدتَ بعد انقطاع | أول مهمة `reflected` خلال 48 ساعة من العودة بعد انقطاع ≥ 3 أيام | مرة، ثم مستويات عند 3 و10 مرات |
| تخليتَ بوعي | مهمة `abandoned` أكملت تأملها، وفيها دليل `reflection_quality` على `self_awareness` بقيمة ≥ 0.5 | مرة |
| طبقتَ في سياق جديد | أول دليل `novel_context` بقيمة ≥ 0.5 | مرة لكل قدرة |
| **تلعب أقل** | يُقيَّم أسبوعيًا، كل الشروط معًا: (1) المرحلة ≥ 3، (2) أيام النشاط في آخر 28 يومًا أقل بـ ≥ 30% من الـ28 السابقة، (3) ≥ 3 تقارير نقل ناجحة في آخر 28 يومًا، (4) لا قدرة نشطة انخفضت > 10 نقاط خلال النافذة، (5) كل فحوص الإتقان في النافذة نجحت | مرة |

الشرط (3) هو ما يفرّق بين "صار مستقلًا" و"ترك التطبيق": من ترك لا يبلّغ عن نقل.

---

## أ.10 مثالان محلولان

### المثال 1: مقاومة المشتت (simulated) — المهارة ظهرت

**القالب:**

```json
{
  "id": "rd-sim-01", "version": 1,
  "mechanic": "resist_distraction", "training_level": "simulated",
  "difficulty": 2, "age_modes": ["teen", "adult"],
  "capability_weights": { "attention": 0.7, "self_control": 0.3 },
  "completion_check": "timer", "min_duration": 5, "max_duration": 5,
  "strategies": [
    { "id": "s1", "text": "أحدد مسبقًا ماذا سأفعل حين يظهر المشتت", "fit": 0.8 },
    { "id": "s2", "text": "أبدأ وأتعامل مع المشتت حين يأتي",        "fit": 0.2 },
    { "id": "s3", "text": "أبعد كل ما قد يشتتني قبل البدء",          "fit": 0.8 }
  ],
  "distraction_config": { "count": 2, "kind": "side_game" },
  "evidence_rules": [
    { "id": "r1", "type": "distraction_response", "capability_id": "attention", "source": "auto",
      "value": { "kind": "choice_map", "field": "distraction_log", "aggregate": "mean",
                 "map": { "ignore": 1.0, "break_return": 0.6, "give_in": -0.4 } } },
    { "id": "r2", "type": "distraction_response", "capability_id": "self_control", "source": "auto",
      "rule_weight": 0.5,
      "value": { "kind": "choice_map", "field": "distraction_log", "aggregate": "mean",
                 "map": { "ignore": 1.0, "break_return": 0.6, "give_in": -0.4 } } },
    { "id": "r3", "type": "strategy_fit", "capability_id": "attention", "source": "auto",
      "value": { "kind": "strategy_fit" } }
  ]
}
```

**ما حدث:** مستخدم teen، دعم L1. اختار s1. ظهر المشتت مرتين: تجاهل الأول، أخذ استراحة وعاد في الثاني. صفر تلميحات. أكمل المؤقت. في التأمل اقترح المرافق دليلًا على `self_awareness` بقيمة 0.6.

**الأدلة الناتجة (5 بالضبط):**

| القاعدة | القدرة | النوع | القيمة | الوزن |
|---|---|---|---|---|
| r1 | attention | distraction_response | (1.0 + 0.6) / 2 = **0.8** | 1.0 × 0.8 = **0.8** |
| r2 | self_control | distraction_response | **0.8** | 1.0 × 0.8 × 0.5 = **0.4** |
| r3 | attention | strategy_fit | **0.8** | **0.8** |
| G2 | autonomy | help_needed | 0 تلميح → **1.0** | 1.0 × 0.8 × 0.5 = **0.4** |
| G4 | self_awareness | reflection_quality | **0.6** | 0.6 × 0.8 = **0.48** |

G1 لم يُطبق (لا انقطاع). G3 لم يُطبق (simulated).

**البوابة الثانية:** على attention (0.7) وself_control (0.3) فقط → **G = 0.8 → `shown`**.
**XP:** gate1 (10 + 5) + gate2_shown 15 + reflection 10 = **40**.

### المثال 2: موقف قراري (guided_real) — أنجز دون إتقان

**القالب:** `plan_ahead`، guided_real، صعوبة 3، الأوزان: planning 0.6، self_awareness 0.2، perseverance 0.2. الموقف: "غرفتك غير مرتبة وموعد خروجك بعد {{time_budget}} دقيقة". سؤال توقع: "كم دقيقة سيستغرق؟". `completion_check: self_report`.

```json
"evidence_rules": [
  { "id": "r1", "type": "strategy_fit", "capability_id": "planning", "source": "auto",
    "value": { "kind": "strategy_fit" } },
  { "id": "r2", "type": "prediction_accuracy", "capability_id": "self_awareness", "source": "auto",
    "value": { "kind": "prediction_error", "tolerance": 1.0 } }
]
```

**ما حدث:** دعم L2. كتب استراتيجية خاصة: "أرتب كل شيء بسرعة" (قيّمها `reflection_coach` بـ `custom_strategy_fit = 0.0`). توقع 20 دقيقة، استغرق 25. انقطع مرة ثم عاد وأكمل. طلب تلميحًا واحدًا. سياق `home` سبق أن ظهر لقدرة planning. في التأمل: مرشح `thinking` بقيمة 0.7.

**الأدلة الناتجة (5 بالضبط):**

| القاعدة | القدرة | النوع | القيمة | الوزن |
|---|---|---|---|---|
| r1 | planning | strategy_fit | **0.0** (مصدر ai لأنها مخصصة) | 0.6 × 1.0 = **0.6** |
| r2 | self_awareness | prediction_accuracy | rel = 0.25 → **0.5** | **1.0** |
| G1 | perseverance | recovery | انقطع وأكمل → **1.0** | **1.0** |
| G2 | autonomy | help_needed | تلميح واحد → **0.3** | 1.0 × 1.0 × 0.5 = **0.5** |
| G4 | thinking | reflection_quality | **0.7** | 0.6 × 1.0 = **0.6** |

G3 لم يُطبق (السياق ليس جديدًا).

**البوابة الثانية:** على planning وself_awareness وperseverance → **G = 0.3947 → `partial`**.
`thinking` و`autonomy` ليستا في أوزان القالب فلا تدخلان البوابة، لكنهما تدخلان درجاتهما في الخريطة.

**الرسالة (GATE-3):** المثابرة ظهرت بوضوح (عاد بعد الانقطاع)، والتخطيط لم يظهر بعد. الاقتراح التالي يميل إلى `decompose`.
**XP:** gate1 (10 + 10) + gate2_partial 5 + reflection 10 = **35**. وتُجدوَل دعوة تعميم (LIFE-1).

---

## أ.11 اختبارات قبول للمحرك (Golden Tests)

يجب أن تمر قبل إغلاق المرحلة 2 و3:

1. مدخلات المثال 1 → الأدلة الخمسة بالقيم والأوزان أعلاه حرفيًا، و`shown`، و40 XP.
2. مدخلات المثال 2 → الأدلة الخمسة، و`partial` بقيمة G = 0.3947 (±0.0001)، و35 XP.
3. أدلة المثال المحسوب في أ.3 → 56% / 0.246 ثم 67% / 0.44.
4. إعادة الحساب الكاملة من `evidence_events` تعطي اللقطات نفسها حرفيًا (حتمية).
5. إعادة إرسال المزامنة نفسها دون اتصال مرتين → لا أدلة ولا XP مكررة (القيود الفريدة).
6. كثافة 0 → لا يُعرض أي عنصر من جدول أ.7.
7. مستخدم يملك أدلة كثيرة في سياق واحد فقط → الثقة لا تتجاوز 0.67.
8. مهمة كل أدلتها مصدرها ai → لا تصل إلى `shown` مهما كانت القيم.
9. مستخدم توقف عن الاستخدام كليًا (صفر تقارير نقل) → لا يحصل على "تلعب أقل".
10. قدرة دعمها L3 → صفر نقاط خطوات، ونقاط النتائج كما هي.
11. متدرب بمستوى تدريب مختلف أو فرق دعم > 1 → الخادم يرفض انضمامه للتحدي.
12. إعادة الحساب تعطي المفاجآت نفسها حرفيًا (مولّد حتمي).

---

## أ.12 إضافات على نموذج البيانات

> مدموجة في الملف الرئيسي (القسم 11) مع إضافات v0.2. هذا القسم للمرجع فقط.

```
missions               + hints_used int default 0
                       + distraction_log jsonb   -- [{at, choice: ignore|break_return|give_in}]
                       + actual_duration_min int
                       + gate1 bool, gate2 text (shown|partial|not_yet), gate2_score numeric

evidence_events        + rule_id text            -- r1 / G2 …
                       + rule_weight numeric
                       + config_version text
                       -- user_id → profile_id

capability_states      profile_id, capability_id,                         -- الحالة الحالية (المرجع للمحرك)
                       support_level, support_changed_at_mission_count,
                       training_level, mastered bool, next_mastery_check_at,
                       PRIMARY KEY (profile_id, capability_id)

capability_snapshots   + config_version text

profiles               + game_intensity_override int null                 -- للبالغ فقط
                       + onboarded_at timestamptz
```

---

## أ.13 نقاط التحدي (جديد في 0.3)

تُحسب لكل مشارك من مهام قالب التحدي فقط، خلال نافذة التحدي، من الأدلة والحالات لا من إدخال حر:

```
attempts_pts    = 4 × عدد المهام reflected (بحد 2 يوميًا، و10 إجمالًا)      → حتى 40
shown_pts       = 12 × shown + 4 × partial                                → حسب المحاولات
transfer_pts    = 15 × تقرير نقل مؤكد من مربٍ + 7 × تقرير ذاتي (حد 4 تقارير)
improvement_pts = clamp(round(2 × (score_end − score_start)), 0, 30)      -- درجة القدرة الأساسية
total           = مجموع ما سبق
```

- **التكافؤ عند الانضمام:** نفس الوضع العمري، نفس `training_level` للقدرة الأساسية، `|support_level − support_level للمنشئ| ≤ 1`، والصعوبة مثبتة للتحدي.
- **الترتيب:** حسب `total`؛ التعادل يتقاسم المرتبة.
- **الأوسمة:** "أكبر تحسن" لأعلى `improvement_pts`، و"أكثر مثابرة" لأعلى عدد مهام reflected (يشمل المتخلى عنها بتأمل). قد يحصل المشارك على أكثر من وسام.
- مهام التحدي تولّد أدلة وXP عادية كأي مهمة.
- لا خصم ولا عقوبة؛ الانسحاب يحذف المشارك من الترتيب فقط.

## أ.14 المفاجآت العشوائية (جديد في 0.3)

```
p(stage)  = { 1: 0.10, 2: 0.06, 3: 0.03, 4: 0.00 }
rng       = حتمي، بذرته mission_id (لتعطي إعادة الحساب النتيجة نفسها)
الأنواع   = cosmetic 50% (عنصر تزيين) · xp_bonus 30% (5–10 XP ضمن السقف اليومي) · encouragement 20%
الحدود    = 1 يوميًا، 3 أسبوعيًا؛ لا مفاجأة إذا الكثافة < 10 أو كان الإعداد معطلًا
```

القيم في `config/game.json`.
