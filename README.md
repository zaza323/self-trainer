# منظومة التدرب على إدارة الذات — المراحل 0 إلى 4

تنفيذ حسب القسم 14 من `docs/PRD-v0.4.md`، مرحلة واحدة في كل مرة:
- **المرحلة 0 (مكتملة)**: المشروع، RTL، المصادقة، الأوضاع العمرية، الصلاحيات، RLS، الوحدات، ملفات الإعدادات، نظام الإعدادات بالطبقات.
- **المرحلة 1 (مكتملة)**: شجرة الغايات بلا ذكاء اصطناعي، مكتبة 20 قالبًا، آلة حالات المهمة، التخطيط، المؤقت، التأمل بأسئلة ثابتة، شاشة الوعي بالتقدم النصية.
- **المرحلة 2 (مكتملة)**: `evidence_events` والحساب واللقطات والخريطة والبوابتان ومستويات الدعم والتدريب — اختبارات الملحق أ.11 (1–5، 7، 8) تمر.
- **المرحلة 3 (مكتملة)**: المساحة الشخصية، عرض XP والمستوى، مراحل الحوافز وكثافة اللعبة، الإنجازات التربوية، الاحتفالات — كثافة 0 تُخفي كل عنصر لعبي، و"تلعب أقل" بالقاعدة الصحيحة (أ.11: 6، 9).
- **المرحلة 4 (مكتملة)**: المرافق بأدواره، وظائف 7.2 عدا adaptation_advisor وtemplate_drafter، الأمان، الحدود والتكلفة — كل وظيفة لها اختبارات ثابتة، لا مخرج غير متحقق يصل القاعدة، تنبيه الأمان يصل المربي فورًا، والسقوط يعمل عند تعطيل المفتاح.
- **تعديل 0.4 — الخطوة 1 (مكتملة)**: أشكال رد المرافق الذكية (الجزء أ): سياسة الشكل يفرضها الخادم، ميزانية الكتابة، stuck، الحد الأدنى اللطيف، الخيارات بالتحقق — الهجرة 0012.
- **تعديل 0.4 — المرحلة 9 (مكتملة)**: أساس المخطط «أدواتي» (الجزء ب): الجداول وRLS بصلاحية `view_planner`، المهام والفرعية وقائمة التحقق والأولويات والتكرار، المشاريع والوسوم والفلاتر، العروض، المحلّل الحتمي بالمعاينة، التذكيرات والتأجيل خارج حد الإشعارات، المتأخر، مستويات الأدوات — الهجرة 0013، `src/modules/planner`.
- **تعديل 0.4 — المرحلة 10 (مكتملة)**: التقويم وTime Blocking، Pomodoro ووضع التركيز، Kanban، أيزنهاور، العادات بأيام مرنة، الإحصائيات، المراجعة الأسبوعية، XP المخطط والإنجازات الجديدة ومحفز `habit_consistency`؛ شاشة البداية ولحظات اليوم (ج)، الحين والتالي (د)، الراحة المجدِّدة (هـ)، التفاعل والإشعارات المتكيّفة (و)، محاسبة النفس (ز)، مرآة الواقع يدويًا (ط) — الهجرة 0014، وحدات `moments`/`followups`/`rest`/`engagement`/`muhasaba`/`mirror`.
- **تعديل 0.4 — المرحلة 11 (مكتملة، آخر خطوات 0.4)**: ذكاء المخطط بالتدرج (`task_parser` الاحتياطي، `task_breakdown`، `day_planner`، صياغة `weekly_review`)، أدلة المخطط P1–P5 والجسر إلى التدريب (تحويل مهمة إلى تدريب)، `overdue_auto_reschedule` للبالغ، G14 مخطط الطفل، الوتيرة الشخصية والزيادة (ح: P47، «زيادتك» في المراجعة، G15)، والشق الذكي من مرآة الواقع (`day_reconstructor` بمعاينة إلزامية، اقتراح أسبوع المرآة، زيادة `reallocate`، مرآة المتابعة، D2/R2/R3) — الهجرة 0015، وحدات `pace` و`planner/{ai,bridge}`.
- ما يحتاج تحققًا لاحقًا: `docs/VERIFY-LATER.md`.

## التقنيات
Next.js 15 (App Router) + TypeScript + Tailwind v4 + مكوّنات بنمط shadcn/ui · Supabase (Auth, PostgreSQL, RLS) · Zod · Vitest.
الاستراتيجية: Modular Monolith في `src/modules/*`، كل وحدة تُصدّر من `index.ts` فقط.

```
config/          القيم القابلة للضبط (منسوخة من المواصفات كما هي) — لا أرقام في الكود
content/         النصوص (شرح التطبيق، سياسة البيانات، أسماء القدرات والميكانيكيات، تسميات الإعدادات)
docs/            PRD-v0.4 والملحق (أ) وREADME-specs وCHANGE-0.3 وCHANGE-0.4 وCONFIG-MERGE-0.4
supabase/migrations/   0001 الأساس + RLS، 0002 أغلفة RPC، 0003 الغايات والقوالب والمهام (1)، 0004 الأدلة والحالات واللقطات وXP (2)، 0005 الإنجازات والعناصر التجميعية (3)، 0006 المحادثة والأمان وai_calls (4) … 0012 أشكال الرد (0.4 أ)، 0013 المخطط (0.4 ب/9)، 0014 لحظات اليوم والمتابعة والراحة والتفاعل والمحاسبة والمرآة (0.4/10)، 0015 الوتيرة وذكاء المخطط والجسر (0.4/11)
scripts/         sync-config-to-db.ts (الكتالوج والحدود)، sync-content-to-db.ts (القوالب)، db-reset-local.ts
src/shared/      config (محمّل Zod)، db (عملاء Supabase)، i18n، ui
src/modules/     accounts، settings، guardian (0) · goals، library، engine، missions (1) · evidence، capabilities (2) · game (3) · companion، safety (4) · الباقي هياكل بمراحلها
tests/rls/       اختبارات RLS على PostgreSQL محلي بمحاكاة auth
```

## التشغيل محليًا

1. **مشروع Supabase**: أنشئ مشروعًا، ثم من SQL Editor نفّذ بالترتيب
   `supabase/migrations/0001_phase0_foundation.sql` ثم `0002_public_rpc_wrappers.sql`
   (أو `supabase db push` إن كنت تستخدم Supabase CLI).
2. **كتالوج الإعدادات** (لا أرقام في SQL؛ تأتي من `config/customization.json`):
   ```bash
   DATABASE_URL="postgres://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres" pnpm config:sync
   ```
   أو اطبع SQL ونفّذه يدويًا: `pnpm config:sql`.
   ثم القوالب: `pnpm content:sync` (أو `pnpm content:sql`).
   **أعد التزامن بعد أي تغيير في `config/*.json` أو `content/capabilities.ar.json` أو `content/mechanics.ar.json` أو `content/templates/*.json`.**
3. **البيئة**: انسخ `.env.example` إلى `.env.local` واملأ `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_ANON_KEY`
   و`SUPABASE_SERVICE_ROLE_KEY` (يُستخدم فقط لإنشاء حساب الطفل في الخادم).
4. **Google OAuth** (ACC-1): فعّل مزود Google في Supabase Auth وأضف `http://localhost:3000/auth/callback` إلى Redirect URLs.
5. **المشرف**: ضع `{"role":"admin"}` في `app_metadata` للمستخدم (من لوحة Supabase أو Admin API).
6. ```bash
   pnpm install
   pnpm dev
   ```

## الاختبارات
```bash
pnpm test            # وحدات: الإعدادات، الصلاحيات، الانتقال العمري، تصيير الشاشات
pnpm test:rls        # RLS على PostgreSQL محلي (يحتاج DATABASE_URL لقاعدة اختبار؛ يُعاد بناؤها كل مرة)
pnpm test:all
pnpm typecheck && pnpm lint && pnpm build
```
اختبارات RLS تستخدم `tests/rls/auth-shim.sql` لمحاكاة `auth.users` و`auth.uid()/jwt()` والأدوار `anon/authenticated/service_role`
كما يفعل Supabase، ثم تنفذ كل استعلام بدور `authenticated` ومطالبات JWT للمستخدم.

## معيار قبول المرحلة 0 (القسم 14)
| المعيار | أين يُتحقق |
|---|---|
| مستخدم في كل وضع ينشئ حسابًا ويرى شاشة فارغة صحيحة | `/signup` → `/onboarding` (P01: teen/adult/مربٍ) → `/app` أو `/guardian`؛ الطفل عبر `/guardian/children/new` (G01) ثم `/child-login` |
| اختبارات RLS تمر | `tests/rls/phase0.test.ts` — 27 اختبارًا (ملكية، مربون، صلاحيات، أقفال، كتالوج، ACC-9، الانتقال العمري، التدقيق) |
| دالة `effective` تمر | `src/modules/settings/resolve.test.ts` — 21 اختبارًا + `app.setting_effective` في RLS |

## معيار قبول المرحلة 1 (القسم 14)
"مستخدم يبني غاية، يأخذ مهمة من اقتراح بقواعد ثابتة، يكملها، يتأمل، ويرى شاشة وعي بالتقدم نصية":
- يبني غاية: `/app/goals/new` (أسئلة ثابتة من `content/fixed_questions.ar.json`؛ المسودة بكلمات المستخدم) و`/app/goals` (P13: إدراج فوق الجذر، نقل، إكمال؛ منع الدورات وحد العمق في الخادم).
- اقتراح بقواعد ثابتة: `modules/engine/select.ts` حتمي (ENGINE-6)، يُستدعى من الرئيسية؛ يراعي `daily_mission_count` و`focus_capabilities` و`break_mode` وتنويع الميكانيكيات.
- آلة الحالات: `app.mission_transition_allowed` + trigger يسجل كل انتقال بوقته ويحسم البوابة الأولى (GATE-1) ويجمّد الوقائع بعد الحسم.
- التخطيط/التنفيذ/التأمل/الوعي: `/app/missions/[id]` يعرض الشاشة بحسب الحالة (P07–P10)، مع المؤقت والمشتت المحاكى (MIS-5) وزر "توقفت" (MIS-6) و"أحتاج تلميحًا" (MIS-11).
- الاختبارات: `tests/rls/phase1.test.ts` (17) + وحدات المحرك والآلة والسرد والقوالب.

## معيار قبول المرحلة 2 (القسم 14): اختبارات الملحق أ.11
| # | الاختبار | أين |
|---|---|---|
| 1 | المثال 1 → الأدلة الخمسة حرفيًا، `shown`، 40 XP | `src/modules/evidence/rules.test.ts` + على القاعدة في `tests/rls/phase2.test.ts` |
| 2 | المثال 2 → الأدلة الخمسة، `partial` G = 0.3947، 35 XP | نفسهما |
| 3 | المثال المحسوب → 56% / 0.246 ثم 67% / 0.44 | `src/modules/capabilities/score.test.ts` (الثقة ±0.001، انظر V2-2) |
| 4 | إعادة الحساب من الأدلة تعطي اللقطات نفسها حرفيًا | `tests/rls/phase2.test.ts` (`recomputeSnapshots` مرتين + مقارنة بالمكتوب) |
| 5 | إعادة الإرسال مرتين → لا أدلة ولا XP مكررة | `tests/rls/phase2.test.ts` (القيود الفريدة + upsert ignoreDuplicates) |
| 7 | سياق واحد → الثقة ≤ 0.67 | `score.test.ts` |
| 8 | أدلة ai فقط → لا `shown` | `rules.test.ts` |

كيف يعمل التقييم: عند الانتقال إلى `reflected` يستدعي server action دالة `evaluateAndRecord` بمفتاح service_role (المتصفح لا يكتب أدلة أبدًا؛ RLS قراءة فقط).
تحسب: الأدلة (أ.2) → البوابة الثانية (أ.4) → XP بالسقف اليومي (أ.8) → درجات القدرات (أ.3) → قرارات الدعم (أ.5) والتدريب (أ.6) والفحص الدوري → لقطات اليوم.
`pnpm recompute` يعيد حساب اللقطات من الأدلة بالإعدادات الحالية (MAP-5). الواجهة: `/app/map` (P12) والمربي يراها في نظرة المتدرب (GUARD-1).

## معيار قبول المرحلة 3 (القسم 14)
| المعيار | أين |
|---|---|
| كثافة 0 تُخفي كل عنصر لعبي (أ.11: 6) | `src/modules/game/game.test.ts` (`visibleElements(0, stage)` فارغة لكل مرحلة) + `space-panel.test.tsx` (لا SVG ولا XP ولا شارات ولا عناصر) + `tests/rls/phase3.test.ts` (تجاوز البالغ = 0) |
| "تلعب أقل" يُمنح بالقاعدة الصحيحة (أ.11: 9) | `game.test.ts` (الشروط الخمسة؛ صفر تقارير نقل → لا يُمنح) + `phase3.test.ts` على القاعدة |

كيف يعمل: بعد التقييم (المرحلة 2) يستدعي server action دالة `afterMissionReflected` بصلاحيات الخدمة: العودة بعد انقطاع (XP + إنجاز بمستويات 1/3/10)،
تخليتَ بوعي، طبقتَ في سياق جديد، عنصر تجميعي (المرحلة 1–2 وshown فقط)، ثم المرحلة (أ.7، انتقال واحد ولا تراجع) والكثافة (المعادلة + تجاوز البالغ من الإعدادات) والمساحة (أ.8، لا تتراجع عبر `avatar_stage_max`).
الواجهة تقرأ `getGameView` وتُخضع كل عنصر لجدول أ.7؛ شاشة الوعي بالتقدم النصية وقائمة الإنجازات النصية لا تختفي أبدًا.

## معيار قبول المرحلة 4 (القسم 14)
| المعيار | أين |
|---|---|
| كل وظيفة تمر اختباراتها الثابتة | `src/modules/companion/runtime.test.ts` (التحقق، إعادة المحاولة مرة، الحدود، السقوط)، `functions/functions.test.ts` (goal_builder مع AI-15، reflection_coach، mission_selector، task_classifier، progress_narrator، weekly_summary، strategy_normalizer)، `chat/service.test.ts` (companion_chat) — بمستدعٍ وهمي (`fakeCaller`) |
| لا مخرج غير متحقق يصل القاعدة | `runFunction` يسجّل `valid=false` بلا `output`، والدوال تسقط إلى سلوكها الثابت؛ RLS تمنع المتصفح من كتابة رسائل ai/الأدلة/التنبيهات |
| تنبيه أمان يصل المربي خلال دقيقة | `tests/rls/phase4.test.ts`: `notify_safety` يكتب إشعارًا لكل مربٍ لديه `receive_alerts` فورًا (خارج حدود الإشعارات)، والمشرف يرى الطابور |
| السقوط يعمل عند تعطيل المفتاح | `AI_DISABLED=1` أو غياب `ANTHROPIC_API_KEY` → `caller.enabled=false` → كل الوظائف تعود إلى الثابت (مُختبر) |

**كيف يعمل**: `ModelCaller` واجهة قابلة للحقن (الحقيقي يستخدم `@anthropic-ai/sdk`، المعرّفات من `AI_MODEL_ID`/`AI_MODEL_ID_LIGHT`، تخزين مؤقت للجزء الثابت من الـSystem Prompt).
`runFunction` = حد يومي من `config/ai.json` → استدعاء → استخراج JSON → Zod → قواعد الخادم (`verify`) → إعادة محاولة مرة → تسجيل في `ai_calls` بـ`prompt_version` و`model_id`.
المحادثة الحرة: مصنّف أمان وارد (كلمات + نموذج) → handoff/الحد → رد مبثوث (SSE في `/api/companion/stream`) → مصنّف صادر وقاعدة السؤال الواحد → تحليل خفيف مهيكل (مؤشرات بوزن منخفض كأدلة `companion`، needs_human، اقتراح سياق).
الشاشات: P14 `/app/chat` (+ زر عائم من كل شاشة)، G03 `/guardian/[id]/chat` (مراقبة حية، تدخّل/إعادة الكلمة، الكتابة بالاسم)، P02 حوار الغاية بمسودة حية، P09 حوار التأمل، P10 سرد المرافق، G10 الملخص الأسبوعي، `/admin` طابور الأمان والتكلفة.

## معيار قبول المرحلة 5 (القسم 14)
| المعيار | أين |
|---|---|
| مربٍ يضيف مهمة ومكافأة ويؤكد نقلًا ويرى أثرها | `tests/rls/phase5.test.ts`: المربي بصلاحية `add_missions` يُدرج مهمة واقعية (قالب خاص `cu-real-*` بملكية المتدرب) ومهمة متكررة تتجسّد يوميًا بلا تكرار؛ مكافأة `draft→active→earned` تُكسب تلقائيًا بعد ظهور المهارة مرتين ثم `delivered→acknowledged` مع `reward_events`؛ تأكيد النقل يولّد دليل `guardian` بوزن T2 و XP، ويظهر أثره في `capability_states` والخريطة |
| محفز ممنوع يُرفض | `app.validate_reward_trigger` يرفض `xp_total`/`streak`/`missions_count`/`login_days` برسالة تشرح السبب (4.12.2)؛ `validateTrigger` الخالصة تُختبر في `rewards/triggers.test.ts`؛ الإنجازات الخاصة لا تقبل `surprise` |
| قفل في child يمنع الطفل من التعديل | `phase5.test.ts`: المربي يقفل `self_missions_require_approval` → كتابة الطفل تُرفض بـ RLS (`settings_can_write`)، ومهمته الذاتية تُدرج بـ `needs_approval=true` ولا يمكن اختيارها قبل `approve_mission` |
| الطفل لا يملك ما ليس له | الطفل لا ينشئ مكافأة لنفسه (`guardian_has_permission` لا يمنح صاحب الحساب)، ولا ينقل مكافأته إلا إلى `acknowledged`؛ البالغ ينشئ مكافأته بنفسه إن سمح `adult_self_rewards` |

**كيف يعمل**: المهام الواقعية = قالب خاص بالمتدرب (`mission_templates.owner_profile_id`) يُصنَّف بـ `task_classifier` أو يدويًا، ويُدرج كمهمة `source=guardian|guardian_recurring|self`؛ الجداول (`mission_schedules`) يجسّدها المحرك يوم الاقتراح.
تقرير النقل (P11) يُفتح من المهمة المتأمَّلة ومن دعوة تظهر في الرئيسية بعد يوم أو ثلاثة (`notifications.type=transfer_invite`) → دليل `self` T1 + مهمة `transferred` + XP؛ تأكيد المربي → دليل `guardian` T2 (وزن أعلى، مستقل عن المهمة).
ملاحظات المربي من قائمة محددة (`content/guardian_observations.ar.json`) → دليل `guardian_observation` بقيمة من `config/scoring.json`.
المكافآت: `app.rewards_guard` يفرض المحفزات المسموحة وحد `max_active_per_player` والانتقالات؛ `evaluateRewardTriggers` يُستدعى بعد كل تقييم ويحوّل `active→earned` ويُخطر الطرفين، ويمنح الإنجازات الخاصة بالقاعدة نفسها.
سياق الحياة (`personal_context`): يحرره المتدرب (والمربي في child بـ `manage_settings`)، مع رفض الأنماط الممنوعة (صحة، موقع دقيق، هاتف) في الخادم؛ اقتراحات المرافق لا تُحفظ إلا بالموافقة.
"دعم أكثر" (`app.request_more_support`): ينزل مستوى الدعم درجة مؤقتًا بمدة من `config/customization.json`.
الشاشات: P11 تقرير النقل (داخل المهمة + دعوة في الرئيسية)، P15 `/app/pledges` (تظهر مهما كانت كثافة اللعبة)، P03 `/onboarding/context` + `/app/context`، `/app/missions/new` (مهمة ذاتية مع تنبيه الموافقة)، G04 `/guardian/[id]/missions/new` (مرة/متكررة، ميكانيكية آلية أو يدوية)، G05/G06 `/guardian/[id]/rewards` (تلميح الإنشاء، إرشاد المرحلة ≥ `stage_guidance_from_stage`، الإنجازات الخاصة)، G12 `/guardian/[id]/context`، G02 (ملاحظة، موافقات، تأكيد النقل، دعم أكثر).

## معيار قبول المرحلة 6 (القسم 14)
| المعيار | أين |
|---|---|
| إكمال مهمة وتأمل دون اتصال يُزامَن بلا تكرار أدلة | `tests/rls/phase6.test.ts`: دفعة [complete, reflect] بمفاتيح من الجهاز تُطبَّق مرة (reflected، أدلة وXP وتأمل واحد، `completed_at` = وقت الجهاز)؛ إعادة إرسال الدفعة نفسها → `replayed` بلا أي تغيير؛ عملية مكررة بمفتاح جديد → `bad_state` بلا تكرار؛ مستخدم آخر → `not_allowed` |
| إشعار واحد يوميًا بوقت المستخدم مع ساعات هدوء (NOTIF-1، NOTIF-4) | `plan.test.ts` + `phase6.test.ts`: الحد اليومي يؤجل إلى وقت الإشعار غدًا، الهدوء يؤجل إلى نهايته، كله بالمنطقة الزمنية للملف؛ الحد الصلب 3 لا يُتجاوز (4.11.3) |
| لا إشعارات خسارة/استعجال/مقارنة (NOTIF-3) | `texts.test.ts`: كل نص في `content/notifications.ar.json` يمر على قائمة الممنوعات؛ `buildMessage` حارس أخير |
| أمان المربي خارج الحد والهدوء (NOTIF-5) | `phase6.test.ts`: `safety_alert` يُرسل في الهدوء وبعد بلوغ الحد، لأجهزة المربي المستلم |
| الاحتفاظ (8.4) | `runRetention`: `chat_auto_delete_days` يحذف نصوص المحادثة الأقدم، والإشعارات الأقدم من `retention_days` |

**كيف يعمل — دون اتصال**: جوهر انتقالات المهمة (`missions/core.ts`) مشترك بين إجراءات الخادم ومسار المزامنة. على الجهاز: طابور Dexie (`src/shared/offline`) يحفظ كل عملية (إكمال/توقف/عودة/تخلٍ/تأمل) بمفتاح uuid ووقت الحدث، وZustand يعرض حالة الاتصال؛ شاشة المهمة تعرض حالة الخادم + العمليات المعلقة (الإسقاط المحلي) وأسئلة التأمل محمّلة مسبقًا. عند عودة الاتصال (حدث online/الظهور/دوريًا/Background Sync عبر الـSW) يُرسل الطابور إلى `/api/sync`: الخادم يدرج كل مفتاح في `client_ops` بـ`on conflict do nothing` — فإن لم يُدرج تُعاد النتيجة المحفوظة ولا يُطبَّق شيء؛ وإن أُدرج يُطبَّق الجوهر بوقت الجهاز (`transition_mission` يقبل `client_at` ولا يقبل مستقبلًا). الأدلة وXP والتأمل idempotent أيضًا بقيودها الفريدة.
**كيف يعمل — الإشعارات**: المخطط (`notifications/service.ts`) ينشئ لكل متدرب "مهمة اليوم"/"عودة بعد انقطاع"/"فحص دوري" بمفتاح تكرار (`dedupe_key`) في وقت `notification_time` المحلي؛ أنواع الأحداث الأخرى (مكافأة مستحقة، دعوة تعميم، موافقة…) تُدرج حيث تقع. الدورة (`/api/cron/tick`، كل `tick_minutes` عبر Vercel Cron أو pg_cron+pg_net، بسر `CRON_SECRET`) تخطط ثم تسلّم: لكل إشعار مستحق قرار من `decideDelivery` (إرسال/تأجيل للهدوء/تأجيل للحد/إسقاط)، ثم Web Push (`web-push` بمفاتيح VAPID) لكل أجهزة المستلم، ويُعلَّم `sent_at` ويبقى في صندوق التطبيق. النصوص والروابط من `content/notifications.ar.json`.
**PWA**: `@serwist/next` يبني `public/sw.js` من `src/app/sw.ts` (precache، NetworkFirst للصفحات، سقوط `/offline`، push/notificationclick، Background Sync، إشعار المؤقت المحلي MIS-4 برسالة من الصفحة). `manifest.webmanifest` قابل للتثبيت. في التطوير الـSW معطّل.
الشاشات: `/app/notifications` (الصندوق + تفعيل إشعارات الجهاز)، G09 `/guardian/notifications`، `/offline`، شريط حالة الاتصال/المزامنة في غلاف المتدرب، إشعار المؤقت في P08.
التهيئة: `pnpm vapid` لتوليد مفاتيح VAPID إلى `.env.local`، و`CRON_SECRET` للدورة. بديل pg_cron: `select cron.schedule('tick','*/15 * * * *', $$select net.http_post(url := 'https://APP/api/cron/tick', headers := '{"Authorization":"Bearer CRON_SECRET"}'::jsonb)$$)`.

## معيار قبول المرحلة 7 (القسم 14)
| المعيار | أين |
|---|---|
| اقتراح مقبول يغيّر الإعداد مع سجل | `tests/rls/phase7.test.ts`: `decide_adaptation_suggestion(accepted)` يكتب طبقة صاحب القرار في `settings` (player في teen/adult، guardian في child) بمصدر تدقيق `adaptation_suggestion` في `settings_audit` + صف `audit_log`؛ القيمة الفعّالة تتغير |
| اقتراح مرفوض لا يتكرر 30 يومًا | المخطط يرشّح بـ `dedupe_key` (النوع+المفتاح+القيمة) ضد المرفوض خلال `reject_cooldown_days` والمعلق؛ مُثبت: بعد الرفض لا يُنشأ، وبعد انقضاء المدة يُنشأ |
| القالب الضعيف يُعلَّم | `computeTemplateMetrics`: ≥ `min_missions_to_evaluate` مهمة ونسبة `shown` < الحد أو تخلٍ > الحد → `template_metrics.flagged` + سبب + سجل تدقيق مرة واحدة؛ المشرف وحده يرى المقاييس |
| من يقرر (5.8) | child → المربي المنشئ أو صاحب `approve_suggestions` (الطفل مرفوض)؛ teen/adult → المتدرب (ومربّيه إن أعطاه `adaptation_suggestions_to`)؛ الجمهور `guardian` لفكرة المهمة الواقعية والدعم الأكثر |
| ذاكرة الاستراتيجيات (ADAPT-3) | `strategy_outcomes` تُحسب بعد كل تأمل من المهام المقيَّمة؛ L0–L1 وسم «نجحت معك سابقًا» في التخطيط؛ L2–L3 المرافق يستحضرها في التأمل (سؤال أول ثابت أو في سياق reflection_coach) |

**كيف يعمل**: `adaptation_advisor` (7.2) يُستدعى أسبوعيًا من `/api/cron/tick` لكل متدرب حان دوره (`run_every_days`) بإحصاءات 14 يومًا (أدلة بالقدرة، المهام بساعة البدء ونتيجتها، الميكانيكيات، التخلي، حالات القدرات) والإعدادات الحالية؛ المخرج يمر بـ Zod ثم `filterSuggestions` (الأنواع المسموحة من `config/customization.json.adaptation.allowed_types`، القيمة تُقص بـ `clampValue` ضمن الكتالوج، لا قيمة مساوية للحالية، حد اقتراحين، لا تكرار للمرفوض/المعلق)، ثم يُحفظ بتاريخ انتهاء ويُخطر صاحب القرار (`adaptation_suggestion`). السقوط = لا اقتراحات. «جرّب ميكانيكية» المقبول يرفع درجة قوالب تلك الميكانيكية في المحرك لمدة `engine_hint_days`. «دعم أكثر» المقبول يستدعي `request_more_support`.
`template_drafter` (ADAPT-7): لكل قالب مُعلَّم بلا مسودة معلقة، نسخة محسّنة (المعرّف والميكانيكية والمستوى والقدرات ثابتة، وتمر بمخطط القالب) تُدرج `draft/ai_draft` بإصدار جديد في طابور `template_draft_reviews`؛ المشرف يعتمد (النسخة الجديدة active والقديمة retired، والمهام الجارية بنسختها) أو يرفض.
ADAPT-8: `pnpm ai:verify` يشغّل كل وظيفة على النموذج الفعلي بمدخلات ثابتة ويفشل إن سقطت أي وظيفة؛ تبديل `AI_MODEL_ID` مشروط بنجاحه.
الشاشات: P18 `/app/suggestions`، G11 `/guardian/[id]/suggestions`، A03+A04 `/admin/templates`.

## تعديل 0.3: نقاط الخطوات، التحديات العادلة، المفاجآت (`docs/CHANGE-0.3.md`)
طُبّق فوق المراحل 0–7 دون إعادة بناء ما يعمل. القيم في `config/game.json` (`xp.step_rewards`، `challenges`، `surprises`) و`config/customization.json` (`challenges_enabled`، `challenge_auto_match`، `surprises_enabled`، الحواجز) بالإصدار `2026-11-05.3`. الهجرة `0010_change03_challenges_surprises.sql`.

| اختبار القبول (القسم 6) | أين |
|---|---|
| 1. قدرة دعمها L3 → صفر نقاط خطوات، ونقاط النتائج كما هي | `game/change03.test.ts` + `tests/rls/change03.test.ts`: `stepXp` يعيد [] عند L3_free أو الإتقان؛ `evaluateAndRecord` يعطي XP النتائج نفسه (المثال 1 = 40) |
| 2. مستوى تدريب مختلف أو فرق دعم > 1 → الانضمام مرفوض | `app.challenge_fairness_check` في الخادم: `training_level` / `support_gap` / `age_mode` / `full` / `window_closed`؛ مُثبت بالرفض ثم القبول عند فرق 1 |
| 3. 5 محاولات في يوم واحد → تُحتسب 2 فقط | `scoreParticipant`: حد يومي 2 وإجمالي 10 من config |
| 4. إعادة الحساب تعطي المفاجآت نفسها حرفيًا | `rollSurprise` حتمي (mulberry32 ببذرة `surprise:mission_id`) + `UNIQUE(mission_id)` + append-only؛ `maybeSurprise` مرتين → النتيجة نفسها وصف واحد |
| 5. المرحلة 4 → لا مفاجآت | احتمال المرحلة 4 = 0 في config؛ مُثبت على 300 بذرة |
| 6. child بلا موافقة مربٍ → لا يدخل أي تحدٍّ | الطفل لا ينشئ (`child_invite_only`)؛ الانضمام بالرمز → `pending` ولا يُعد مشاركًا (`challenge_member`=false، لا نقاط) حتى `approve_challenge_participant` من المنشئ/manage_settings |
| 7. كل اختبارات الملحق أ.11 السابقة ما زالت تمر | المجموعة الكاملة (انظر جدول التحقق أدناه) |

**كيف يعمل**: نقاط الخطوات (`awardStepXp`) تُمنح بعد `reflected` من `afterMissionReflected` بمصادر `mission_id` و`mission_id:n` ضمن السقف اليومي، وتتوقف عند L3 أو الإتقان؛ النتائج (أ.8) كما هي في محرك الأدلة. التحديات: إنشاء/انضمام/موافقة/انسحاب كلها RPC بصلاحيات الخادم (`create_challenge`، `join_challenge_by_code`، `approve_challenge_participant`، `leave_challenge`) مع فحص التكافؤ من `config_meta.edit_rules._challenges`؛ النقاط (`challenges/scoring.ts`) من الأدلة فقط داخل النافذة، والترتيب بالتعادل المتقاسم، والأوسمة «أكبر تحسن» و«أكثر مثابرة»؛ الدورة (`tickChallenges` في `/api/cron/tick`) تعيد الحساب وتنهي/تلغي. الممنوعات مفروضة بالتصميم: لا لوحة عامة (RLS للمشاركين)، لا محادثة، لا إشعار تجاوز، لا خصم، لا عقوبة انسحاب. المفاجآت (`maybeSurprise`): احتمال حسب المرحلة، 1 يوميًا و3 أسبوعيًا، تختفي تحت الكثافة 10 أو عند التعطيل؛ الزينة تظهر في المساحة، النقاط ضمن السقف اليومي، والتشجيع نص.
الشاشات: P21 `/app/challenges` (تظهر عند كثافة ≥ 30 والإعداد مفعّل)، P22 `/app/challenges/[id]`، G13 `/guardian/[id]/challenges`.

## المرحلة 8: التجربة المغلقة (القسم 14) ومقاييس النجاح (القسم 15)
المرحلة تشغيلية في جوهرها (15–30 مستخدمًا على الأوضاع المفعّلة، 4 أسابيع)؛ ما بُني هو ما تحتاجه لإدارتها وقياسها بلا كتابة أرقام في الكود:
| ما بُني | أين |
|---|---|
| الدفعة: إنشاء، تسجيل مشاركين بحدود `config/trial.json` (الحد الأقصى، الأوضاع المفعّلة، الحد الأدنى لكل وضع)، التوزيع على الأوضاع | `app.create_trial_cohort` / `app.enroll_trial_participant` (المشرف فقط) + A08 `/admin/trial` |
| مقاييس القسم 15 الثمانية ضد أهدافها + التحذيران المضادان، لقطة أسبوعية من الدورة | `trial/metrics.ts` (خالص) + `snapshotCohort`/`tickTrial` في `/api/cron/tick` |
| أحداث منتج مجهّلة (القسم 9): قائمة أحداث وخصائص مسموحة، لا نص حر، hash مملّح للمعرّف، PostHog اختياري عبر `POSTHOG_KEY` | `trial/analytics.ts` + جدول `product_events`؛ خطافات عند التأمل وتقرير النقل وقرار التكيّف والتصدير والحذف |
| تصدير البيانات JSON (8.4) للمالك وللمربي المنشئ عن طفله | `/api/export` + بطاقة «بياناتي» في الإعدادات وصفحة المتدرب عند المربي |
| حذف الحساب: المالك في teen/adult، المربي المنشئ فقط للطفل (الطفل لا يحذف)، تعاقب كامل وسجل تدقيق مجهّل | `app.delete_player_account` + `deleteAccount` |
| سجل تدقيق لكل وصول مشرف (ADMIN-6) | `app.log_admin_access` من كل صفحة مشرف |
| جاهزية الإطلاق: البيئة، موارد الأمان المتحقق منها، القوالب النشطة | `readiness` في A08 و`pnpm trial:readiness` |

**تفسيرات القسم 15 الكمية** (في `config/trial.json`، تُعدَّل بلا كود): نمو المهارة = نسبة المؤهلين (≥ 10 مهام) الذين تحسنت ≥ 2 من قدراتهم المستهدفة بين الأسبوع 1 و4، الهدف ≥ 50% منهم؛ الاستقلالية = نسبة من ارتفع دعمهم مستوى في قدرة واحدة على الأقل (مع متوسط تغير `help_needed` كملاحظة)؛ الإتقان لا الإنجاز = نسبة `shown` إلى «أنجز فقط» في الأسبوع 4 مقابل 1 (اتجاه صاعد)؛ سياق جديد = الفرق النسبي بين متوسط أدلة `novel_context` وبقية الأدلة؛ العودة = نشاط في يوم ≥ 7/30 من الانضمام بين المؤهلين لذلك؛ التحذير 1 = XP يرتفع ≥ 50% ومتوسط تغير القدرات ≤ 2 نقاط؛ التحذير 2 = `shown` ينخفض ≥ 15 نقطة في 14 يومًا بعد تسليم مكافأة مقارنة بما قبلها (بحد أدنى 3 مهام في كل نافذة).

## الشاشات المبنية في المرحلة 0
P01 اختيار الوضع/الشرح · P06 الرئيسية الفارغة (مع "من يرى ماذا") · P17 الإعدادات (القيمة الفعّالة، من ضبطها، القفل) ·
شاشة المربين للمتدرب (ACC-5/7/10) · G01 إنشاء الطفل + الموافقة · G02 اللوحة والتنقل بين المتدربين · G07 الإعدادات والأقفال ·
G08 إدارة المربين والصلاحيات · قبول الدعوة بالرمز · تغيير الوضع العمري (ACC-11).

## نظام الإعدادات بالطبقات (4.11)
- `settings.effective(profileId, key)` في `src/modules/settings` هو **المسار الوحيد** لقراءة أي إعداد.
- الترتيب من `config/customization.json.resolution_order`: تجاوز المهمة ← المتدرب (إن لم يكن مقفلًا وكان الوضع يسمح) ← المربي ← الافتراضي حسب الوضع ← الافتراضي العام، ثم clamp.
- الإنفاذ ثلاثي: TypeScript (رسائل واضحة) + trigger `app.settings_validate` (القيمة ضد الكتالوج) + RLS عبر `app.settings_can_write` (من يعدّل ماذا ويقفل).
- كل تغيير → `settings_audit` تلقائيًا، وتغيير المربي → إشعار صاحب الحساب (`notifications`).
- الحواجز (4.11.3) غير موجودة في الكتالوج أصلًا، فلا يمكن ضبطها.

## قرارات تفسيرية موثقة (خارج نص المواصفات)
1. **حساب المربي فقط** صف في `profiles` بـ `kind = 'guardian'` و`age_mode = null` (المواصفات تذكر `profiles` فقط ولا تفصّل حساب المربي).
2. **دخول الطفل**: Supabase Auth يتطلب بريدًا، فالطفل يدخل بـ"رمز دخول" + كلمة سر يختارهما المربي، ويُحوَّل الرمز داخليًا إلى `code@child.local`. حساب الطفل يُنشأ في الخادم بمفتاح service role ثم `create_child_profile` (ACC-3).
3. **صف `system`** في `settings` يُحتسب بعد طبقة المربي وقبل الافتراضي (للقيم التي يكتبها المحرك لاحقًا)، ولا يُكتب من المتصفح.
4. **الافتراضي العام** عند غياب الوضع العمري = افتراضي `adult` من الكتالوج (لا يصل إليه متدرب فعليًا).
5. **القفل في teen** مقصور على `lockable_keys_override` (إعدادات الأمان) — القرار المفتوح 9.
6. `notifications` و`audit_log` أُنشئا مبكرًا بالحد الأدنى لأن CUST-6 وADMIN-6 بأولوية M.

## ما ليس في المراحل 0–8 (بحسب القسم 14)
من الأولويات S/C خارج المراحل: محرر القوالب بالإصدارات للمشرف (ADMIN-1)، محرر الإعدادات (ADMIN-3)، إثبات الصورة (MIS-7). التجربة نفسها (المستخدمون الحقيقيون و4 أسابيع) تشغيل لا كود: انظر `docs/VERIFY-LATER.md`.
`content/` يحتوي ما تطلبه المرحلة 0 فقط (`explainers`)، وبقية المحتوى تربوي يُكتب خارج الكود (القسم 18).
