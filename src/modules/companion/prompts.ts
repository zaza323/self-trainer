/**
 * بناء System Prompts من content/companion_system_prompt.md (7.1). الثابت أولًا (قابل للتخزين المؤقت)، ثم المتغيّر.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgeMode, SupportLevel } from "@/shared/config";

export const PROMPT_VERSION = "2026-11-06.1";

let cached: Record<string, string> | null = null;
function sections(): Record<string, string> {
  if (cached) return cached;
  const md = readFileSync(path.resolve(process.cwd(), "content/companion_system_prompt.md"), "utf8");
  const out: Record<string, string> = {};
  const re = /<!-- section:([\w:]+) -->\n([\s\S]*?)(?=\n<!-- section:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out[m[1]!] = m[2]!.trim();
  cached = out;
  return out;
}

/** الجزء الثابت لكل وضع عمري (يُخزَّن مؤقتًا في API). */
export function personaSystem(mode: AgeMode, opts: { jsonContract?: boolean } = {}): string {
  const s = sections();
  return [s.persona, s.rules, s[`style:${mode}`], s.safety, opts.jsonContract === false ? "" : s.output_contract].filter(Boolean).join("\n\n");
}

export function supportStyle(level: SupportLevel): string {
  const map: Record<SupportLevel, string> = {
    L0_instruct: "مستوى الدعم L0: يجوز مثال واحد ثم اطلب من المستخدم مثاله.",
    L1_hint: "مستوى الدعم L1: تلميح فقط عند الطلب أو التعثر.",
    L2_ask: "مستوى الدعم L2: اسأل عن الخطة ولا تقترح.",
    L3_free: "مستوى الدعم L3: اكتفِ بـ«ما خطتك؟» و«كيف سار الأمر؟».",
  };
  return map[level];
}

export const FUNCTION_INSTRUCTIONS = {
  goal_builder: `المهمة: بناء الغاية الأولى حوارًا (5.1). اسأل سؤالًا واحدًا في كل دور، اعكس كلمات المستخدم كما قالها في reflection_of_user_words،
واصعد «ولماذا هذا؟» حلقة بعد حلقة (phase=climb_why) حتى يقول المستخدم إنه السبب الأخير أو يرغب في التوقف، ثم انزل إلى خطوة أولى قابلة للتنفيذ هذا الأسبوع (descend_how)،
ثم confirm بعرض المسودة. المسودة (draft) بكلمات المستخدم حرفيًا، لا بصياغتك. عند done اجعل next_question=null. سمِّ حركة التفكير فقط بعد حدوثها فعلًا.
أشكال الرد (0.4 أ): أضف moment وresponse_mode وoptions إلى المخرج. الخادم يقرر الشكل النهائي من السياسة ويستبدل شكلك إن خالفها، فاقترح فقط.
options (عند choices_plus_other أو quick_replies): 2–4 خيارات قصيرة (≤ 40 حرفًا) بلا تكرار ولا خطة كاملة، كل خيار {label, source}، ومن كلمات المستخدم أولًا حين تتوفر (source="user_words"). عند free_text اجعل options=[].
لا تضف زر «غير ذلك» (الواجهة تضيفه). في goal_why لا تضع خيارات أبدًا.
المخطط: { next_question, reflection_of_user_words, thinking_move_named, phase, draft:{goals:[{temp_id,parent_temp_id,title_user_words,why_user_words}], first_step_user_words}, needs_user_confirmation, safety:{flag,category,severity}, moment, response_mode, options:[{label,source}] }`,
  reflection_coach: `المهمة: تعميق التأمل بعد المهمة (5.2 خطوة 6) بسؤال واحد في كل دور وبحد أقصى 4 أدوار. عند done اكتب reflection_summary_user_words من كلمات المستخدم.
evidence_candidates: حتى 3 مرشحين من نوع reflection_quality بقيمة −1..1 مع rationale من جملة واحدة، فقط لقدرات القالب أو self_awareness أو thinking، ومعناها: هل ربط المستخدم النتيجة بسبب محدد قابل للتغيير؟
custom_strategy_fit: فقط إن كتب المستخدم استراتيجيته الخاصة (−1..1 لملاءمتها للموقف)، وإلا null. لا تقرر أنت البوابة الثانية.
أشكال الرد (0.4 أ): أضف moment وresponse_mode وoptions إلى المخرج. الخادم يقرر الشكل النهائي من السياسة ويستبدل شكلك إن خالفها، فاقترح فقط.
options (عند choices_plus_other أو quick_replies): 2–4 خيارات قصيرة (≤ 40 حرفًا) بلا تكرار ولا خطة كاملة، كل خيار {label, source}، ومن كلمات المستخدم أولًا حين تتوفر (source="user_words"). عند free_text اجعل options=[].
لا تضف زر «غير ذلك» (الواجهة تضيفه). في goal_why لا تضع خيارات أبدًا.
المخطط: { next_question, done, reflection_summary_user_words, thinking_move_named, custom_strategy_fit, evidence_candidates:[{capability_id,type:"reflection_quality",value,rationale}], safety, moment, response_mode, options:[{label,source}] }`,
  mission_selector: `المهمة: اختر template_id واحدًا من قائمة المرشحين المعطاة فقط، واملأ المتغيرات من سياق حياة المستخدم (context ≤ 120 حرفًا، time_budget دقائق) ضمن حدود القالب، وصعوبة 1–5 ضمن المقترح. rationale جملة واحدة. المخطط: { template_id, variables:{context,time_budget}, difficulty, rationale }`,
  task_classifier: `المهمة: صنّف مهمة كتبها المستخدم أو المربي: الميكانيكية الأنسب من العشر، أوزان القدرات (مجموعها 1، القدرة الأساسية للميكانيكية هي الأعلى)، suggested_goal_id من قائمة الغايات المعطاة أو null، و2–4 أسئلة تأمل قصيرة بأسلوب الوضع العمري. المخطط: { mechanic, capability_weights, suggested_goal_id, reflection_prompts }`,
  progress_narrator: `المهمة: شاشة الوعي بالتقدم (5.2 خطوة 7): سرد قصير (≤ 5 جمل) من وقائع المهمة فقط، بلا نقاط ولا أحكام ولا مبالغة؛ يبرز القدرة التي ظهرت فعلًا ويسمي حركة التفكير إن حدثت. المخطط: { narrative, highlighted_capability }`,
  companion_chat_analysis: `المهمة: حلّل آخر رسالة للمستخدم وردّ المرافق واستخرج JSON فقط: insights (حتى 3 مؤشرات تعلم بوزن منخفض، لا أحكام)، needs_human (قرار عائلي، موضوع خارج النطاق، إلحاح للتحدث مع المربي)، safety، context_suggestion (حقل واحد من سياق الحياة إن ذُكر شيء ملموس ومسموح: لا صحة ولا أسماء غرباء ولا مواقع دقيقة) أو null.
المخطط: { insights:[{capability_id,type,value,confidence}], needs_human:{flag,reason}, safety:{flag,category,severity}, context_suggestion:{field,value}|null }`,
  weekly_summary: `المهمة: ملخص أسبوعي للمربي من أدلة الأسبوع: improved (ما تحسن)، needs_support (ما يحتاج دعمًا)، guardian_tip (اقتراح واحد عملي للمربي). بلا تشخيص ولا أحكام. المخطط: { improved[], needs_support[], guardian_tip }`,
  strategy_normalizer: `المهمة: وحّد استراتيجية مخصصة تحت تسمية قصيرة (≤ 4 كلمات) مناسبة للميكانيكية. المخطط: { label }`,
  adaptation_advisor: `المهمة: من أدلة الأسبوعين وتوقيت المهام ونتائجها والإعدادات الحالية، اقترح حتى اقتراحين من الأنواع المسموحة فقط (أو لا شيء إن لم يكن هناك سبب واضح).
لكل اقتراح: type من القائمة، setting_key المطابق للنوع (أو null)، proposed_value (قيمة الإعداد الجديدة؛ أو {mechanic} لـtry_mechanic؛ أو {capability_id} لـrequest_more_support؛ أو {idea} لـreal_mission_idea)، reason_short (سطر واحد من الأدلة)، expected_effect (سطر واحد). بلا تشخيص. المخطط: { suggestions: [{ type, setting_key, proposed_value, reason_short, expected_effect }] }`,
  template_drafter: `المهمة: قالب تدريب ضعيف المقاييس؛ اكتب نسخة محسّنة كاملة بحقول القالب نفسها (id والميكانيكية ومستوى التدريب والقدرات ثابتة)، بمواقف أوضح واستراتيجيات أدق وتلميحات أفضل، مع rationale قصير يشرح ما تغيّر ولماذا. المخرج للمشرف فقط. المخطط: { template, rationale }`,
  muhasaba_coach: `المهمة: محاسبة النفس قبل النوم (0.4 ز). المستخدم كتب سبب تقصيره. سؤال واحد يعمّق الفهم (next_question) أو تلخيص بكلماته (done=true).
قواعد لا تُكسر: التقصير سلوك لا هوية؛ لا تؤكد أي حكم على الذات («فاشل»، «كسول»)؛ إن جلد المستخدم ذاته فاعكس كلامه بلطف وأعده للسلوك المحدد: «اليوم ما مشيت المراجعة. شو اللي صعّبها؟».
evidence_candidates: حتى مرشح واحد reflection_quality على self_awareness فقط إن ربط السبب بشيء محدد قابل للتغيير. المخطط: { next_question, done, reflection_summary_user_words, thinking_move_named, custom_strategy_fit:null, evidence_candidates, safety, moment:"obstacle_naming", response_mode:"free_text", options:[] }`,
  task_parser: `المهمة: احتياطي للمحلّل الحتمي للإدخال السريع (0.4 ب.4). استخرج حقول مهمة واحدة من نص المستخدم. التاريخ YYYY-MM-DD محسوبًا من «اليوم» المعطى، والوقت HH:MM (الساعة الغامضة 1..N مساءً حسب المعطى). لا تخترع موعدًا لم يُذكر: اتركه null.
المخطط: { title, due_date, due_time, priority:"high"|"medium"|"low"|"none", tags:[], project, estimate_min, reminder_offset_min }`,
  task_breakdown: `المهمة: تقسيم مهمة كبيرة إلى خطوات صغيرة قابلة للتنفيذ (0.4 ب.10). كل خطوة فعل واضح ≤ 80 حرفًا، بلا تكرار.
mode=propose_draft: حتى max_steps خطوات كمسودة. mode=suggest_missing: المستخدم كتب خطواته؛ اقترح حتى max_steps خطوات ناقصة فقط، لا تكرر خطواته ولا تعيد صياغتها.
المخطط: { steps:[{title, estimate_min}], note }`,
  day_planner: `المهمة: اقتراح أماكن مهام اليوم (0.4 ب.10). استخدم فقط task_id من القائمة المعطاة، وفي mode=place_picks فقط المهام التي اختارها المستخدم. لا تضع مهمة في وقت مشغول ولا قبل «الآن». المهمة ذات الوقت تبقى في وقتها.
المخطط: { placements:[{task_id, start:"HH:MM"}], note }`,
  weekly_review: `المهمة: صياغة فقط لسطرين في المراجعة الأسبوعية (0.4 ح.5). الأرقام والقرارات محسوبة في الخادم ومعطاة لك؛ لا تضف رقمًا ليس في المعطيات، ولا تقارن بأي شخص آخر، ولا تلُم. لغة الوضع العمري.
المخطط: { intro, increment_line }`,
  day_reconstructor: `المهمة: تحويل كلام المستخدم عن يومه إلى مقاطع زمنية (0.4 ط.7). استخدم فقط الأوقات التي ذكرها المستخدم حرفيًا أو حدود المقاطع المعروفة المعطاة؛ لا تخترع وقتًا. ما لا وقت له لا يصير مقطعًا؛ الفجوات تبقى فجوات. category من القائمة المعطاة فقط. لا أسماء أشخاص ولا مواقع في label.
المخطط: { blocks:[{start:"HH:MM", end:"HH:MM", category, label, confidence}], gaps:[{start, end}] }`,
  safety_classifier: `المهمة: صنّف النص للفئات: self_harm، abuse، immediate_danger، age_inappropriate. flag=true فقط عند وجود مؤشر حقيقي، مع severity. لا تفسير. المخطط: { flag, category, severity }`,
} as const;

export type FunctionName = keyof typeof FUNCTION_INSTRUCTIONS | "companion_chat";
