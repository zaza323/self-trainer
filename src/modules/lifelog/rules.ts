/**
 * «سجل حياتي» (0.5 الجزء أ) — قواعد نقية حتمية. لا ذكاء اصطناعي هنا: التحقق الحرفي، قائمة المنع، الحدود، التقادم، التجديد،
 * مصادر السيناريو، وتركيب نص الموقف. الوقت يُحقن. القيم من config/customization.json.personal_context.
 */
import { customization, type AgeMode } from "@/shared/config";
import blocklist from "@content/context_blocklist.ar.json";
import content from "@content/life_log.ar.json";

type PcCfg = {
  max_items_per_field: number; forbidden_content: string[]; item_max_chars: number; scenario_fields: LifeField[];
  intake: { reask_after_days: number; max_followups: number; steps: Array<{ moment: string; field: string; mode: string }> };
  refresh: { every_days_setting: string; stale_after_days: number };
};
export const lifeConfig = customization.personal_context as unknown as PcCfg;

export const LIFE_FIELDS = ["roles", "responsibilities", "dependents", "pressures"] as const;
export type LifeField = (typeof LIFE_FIELDS)[number];
export type ItemSource = "user_typed" | "user_voice" | "guardian_for_child" | "companion_suggested_confirmed";
export type LifeItem = { id: string; text: string; source: ItemSource; confirmed_at: string; last_confirmed_at: string; archived: boolean };
export type LifeLog = Record<LifeField, LifeItem[]>;
export type IntakeStatus = "not_started" | "partial" | "done" | "skipped";
export const emptyLog = (): LifeLog => ({ roles: [], responsibilities: [], dependents: [], pressures: [] });

/** التطبيع للمطابقة فقط (أ.4): حذف التشكيل والتطويل، توحيد الألف والياء والتاء المربوطة، مسافات مفردة، أحرف صغيرة. */
export function normalizeForMatch(s: string): string {
  return s.replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, " ").trim().toLowerCase();
}

/** أ.4-1: نص المرشح جزء حرفي من رسالة المستخدم بعد التطبيع (السجل بكلمات المستخدم لا بتأليف النموذج). */
export function isVerbatim(candidate: string, userMessage: string): boolean {
  const c = normalizeForMatch(candidate);
  return c.length > 0 && normalizeForMatch(userMessage).includes(c);
}

export type BlockReason = "health" | "precise_locations" | "income" | "non_family_person_names" | "religion_practices_assumed" | "phone";
const B = blocklist as unknown as Record<string, string[]> & { phone_digits_min: number };
const hasWord = (n: string, w: string) => new RegExp(`(^|[^\\p{L}])(ال|و|ب|ل|لل|ف)?${normalizeForMatch(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(n);

/** أ.2: المحتوى الممنوع بقائمة الكلمات. يعيد سبب المنع أو null. */
export function blockedReason(text: string): BlockReason | null {
  const n = normalizeForMatch(text);
  const on = (k: string) => lifeConfig.forbidden_content.includes(k);
  if (on("health") && B.health!.some((w) => hasWord(n, w))) return "health";
  if (on("income") && B.income!.some((w) => hasWord(n, w))) return "income";
  if (on("precise_locations")) {
    if (B.precise_locations!.some((w) => hasWord(n, w))) return "precise_locations";
    if (new RegExp(`\\d{${B.phone_digits_min},}`).test(n.replace(/[\s-]/g, ""))) return "phone";
  }
  if (on("non_family_person_names") && (B.non_family_person_names!.some((w) => hasWord(n, w)) || B.name_patterns!.some((w) => hasWord(n, w)))) return "non_family_person_names";
  if (on("religion_practices_assumed") && B.religion_practices_assumed!.some((w) => hasWord(n, w))) return "religion_practices_assumed";
  return null;
}

export type AddResult = { ok: true; log: LifeLog; item: LifeItem } | { ok: false; reason: "empty" | "too_long" | "blocked" | "max_items"; blocked?: BlockReason };

/** إضافة عنصر مؤكَّد بكلمات المستخدم كما هي. المعرّف والوقت يُحقنان. */
export function addItem(log: LifeLog, field: LifeField, text: string, source: ItemSource, i: { id: string; now: string }): AddResult {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return { ok: false, reason: "empty" };
  if (t.length > lifeConfig.item_max_chars) return { ok: false, reason: "too_long" };
  const blocked = blockedReason(t);
  if (blocked) return { ok: false, reason: "blocked", blocked };
  const active = log[field].filter((x) => !x.archived);
  const dup = active.find((x) => normalizeForMatch(x.text) === normalizeForMatch(t));
  if (dup) return { ok: true, log, item: dup };
  if (active.length >= lifeConfig.max_items_per_field) return { ok: false, reason: "max_items" };
  const item: LifeItem = { id: i.id, text: t, source, confirmed_at: i.now, last_confirmed_at: i.now, archived: false };
  return { ok: true, log: { ...log, [field]: [...log[field], item] }, item };
}

export function removeItem(log: LifeLog, field: LifeField, id: string): LifeLog { return { ...log, [field]: log[field].filter((x) => x.id !== id) }; }
export function editItem(log: LifeLog, field: LifeField, id: string, text: string, now: string): AddResult {
  const cur = log[field].find((x) => x.id === id);
  if (!cur) return { ok: false, reason: "empty" };
  const r = addItem({ ...log, [field]: log[field].filter((x) => x.id !== id) }, field, text, cur.source, { id, now });
  return r.ok ? { ...r, log: { ...r.log, [field]: r.log[field].map((x) => (x.id === id ? { ...x, confirmed_at: cur.confirmed_at } : x)) } } : r;
}

const daysSince = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 86400000;

/** أ.6: عنصر مضى على تأكيده أكثر من stale_after_days لا يُستخدم في مواقف جديدة قبل تأكيده بلمسة. */
export function isStale(item: LifeItem, now: Date): boolean { return daysSince(item.last_confirmed_at, now) > lifeConfig.refresh.stale_after_days; }
export function confirmItem(log: LifeLog, field: LifeField, id: string, now: string): LifeLog { return { ...log, [field]: log[field].map((x) => (x.id === id ? { ...x, last_confirmed_at: now } : x)) }; }
/** «ما تغيّر»: يجدد last_confirmed_at لكل العناصر، ولا يغيّر أي شيء آخر. */
export function confirmAll(log: LifeLog, now: string): LifeLog {
  return Object.fromEntries(LIFE_FIELDS.map((f) => [f, log[f].map((x) => (x.archived ? x : { ...x, last_confirmed_at: now }))])) as LifeLog;
}

/** التجديد كل life_refresh_days منذ آخر تجديد (أو إتمام التعارف). لا تجديد قبل إتمام التعارف. */
export function refreshDue(i: { intakeStatus: IntakeStatus; intakeCompletedAt: string | null; lastRefreshAt: string | null; everyDays: number; now: Date }): boolean {
  if (i.intakeStatus !== "done") return false;
  const base = i.lastRefreshAt ?? i.intakeCompletedAt;
  return base ? daysSince(base, i.now) >= i.everyDays : false;
}
/** بعد التخطي: إعادة السؤال بلطف بعد reask_after_days. */
export function reaskDue(i: { intakeStatus: IntakeStatus; skippedAt: string | null; now: Date }): boolean {
  return i.intakeStatus === "skipped" && Boolean(i.skippedAt) && daysSince(i.skippedAt!, i.now) >= lifeConfig.intake.reask_after_days;
}
/** هل يُعرض التعارف الآن؟ (أول مرة، أو غير مكتمل، أو حان وقت إعادة السؤال) */
export function intakeDue(i: { intakeStatus: IntakeStatus; skippedAt: string | null; now: Date }): boolean {
  return i.intakeStatus === "not_started" || i.intakeStatus === "partial" || reaskDue(i);
}
export function followUpAllowed(used: number): boolean { return used < lifeConfig.intake.max_followups; }

// ---------------------------------------------------------------- مصادر السيناريو (أ.5)
export type RefType = "planner_task" | "life_entry" | "user_typed";
export type ScenarioSource = { ref_type: RefType; ref_id: string | null; text: string };
export type Provenance = Array<{ name: string; ref_type: RefType; ref_id: string | null }>;
export const SCENARIO_VARIABLE = "life_entry_text";
export type LifeBinding = "none" | "optional" | "required";

/**
 * المصادر بالترتيب: (1) مهام المخطط التي كتبها المستخدم وفيها موعد، (2) عناصر السجل المؤكَّدة غير المؤرشفة وغير المتقادمة.
 * (3) موقف يكتبه المستخدم الآن يُضاف صراحة عند الطلب. لا مصدر رابعًا، ولا عنصر غير مؤكَّد.
 */
export function scenarioSources(i: { plannerTasks: Array<{ id: string; title: string; due_date: string | null; status: string; created_via: string }>; log: LifeLog; now: Date; today: string }): ScenarioSource[] {
  const tasks = i.plannerTasks.filter((t) => t.status === "open" && t.due_date !== null && t.due_date >= i.today && t.created_via !== "guardian" && !blockedReason(t.title))
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : a.id.localeCompare(b.id)))
    .map((t) => ({ ref_type: "planner_task" as const, ref_id: t.id, text: t.title }));
  const entries = lifeConfig.scenario_fields.flatMap((f) => i.log[f]).filter((x) => !x.archived && Boolean(x.confirmed_at) && !isStale(x, i.now))
    .map((x) => ({ ref_type: "life_entry" as const, ref_id: x.id, text: x.text }));
  return [...tasks, ...entries];
}

/** أهلية القالب: none دائمًا؛ required يحتاج مصدرًا؛ optional يحتاج مصدرًا أو تعارفًا مكتملًا (فيُعرض بسياق محايد بلا قصة). */
export function templateEligible(binding: LifeBinding, sourcesCount: number, intakeStatus: IntakeStatus): boolean {
  if (binding === "none") return true;
  if (sourcesCount > 0) return true;
  return binding === "optional" && intakeStatus === "done";
}

/** اختيار حتمي لمصدر القالب: الأول غير المستعمل اليوم، مع إزاحة حسب فهرس الاقتراح. */
export function pickSource(sources: ScenarioSource[], used: Set<string>, index: number): ScenarioSource | null {
  const free = sources.filter((s) => !used.has(`${s.ref_type}:${s.ref_id}`));
  const pool = free.length ? free : sources;
  return pool.length ? pool[index % pool.length]! : null;
}

/** مرجع يقترحه النموذج يُقبل فقط إن كان ضمن مصادر هذا المستخدم التي أعطاها الخادم. */
export function acceptRef(ref: { ref_type: string; ref_id: string | null } | null | undefined, sources: ScenarioSource[]): ScenarioSource | null {
  if (!ref) return null;
  return sources.find((s) => s.ref_type === ref.ref_type && s.ref_id === ref.ref_id) ?? null;
}

export function provenanceFor(src: ScenarioSource): Provenance { return [{ name: SCENARIO_VARIABLE, ref_type: src.ref_type, ref_id: src.ref_id }]; }

/** أ.5: نص الموقف يركّبه الخادم من قالب محايد في الجنس: «حسب ما حكيت: {نص العنصر}. {سؤال القالب}». */
export function composeScenario(entryText: string, question: string): string {
  const text = entryText.trim().replace(/[.،؛!؟\s]+$/u, "");
  return content.scenario.template.replace("{text}", text).replace("{question}", question.trim());
}
export const neutralContext = content.scenario.neutral_context;

/** الفئات العمرية لا تغيّر القاعدة؛ تُترك للتوثيق. */
export type LifeProfile = { id: string; age_mode: AgeMode; timezone: string };

// ---------------------------------------------------------------- الالتزامات الثابتة (أ.3 خطوة 3)
export type Commitment = { label: string; days: number[]; from: string; to: string };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function commitmentText(c: Commitment, weekdayNames: string[]): string {
  return `${c.label.trim()}: ${[...new Set(c.days)].sort().map((d) => weekdayNames[d]).join("، ")} ${c.from}–${c.to}`;
}
export function validCommitment(c: Commitment): boolean {
  return c.label.trim().length > 0 && c.days.length > 0 && c.days.every((d) => d >= 0 && d <= 6) && HHMM.test(c.from) && HHMM.test(c.to) && c.from < c.to;
}
/** يقترح نافذة متاحة واحدة: من نهاية آخر التزام إلى بداية ساعات الهدوء، إن اتسعت لـ minMinutes. تُحفظ بموافقة المستخدم فقط. */
export function suggestWindows(commitments: Array<{ from: string; to: string }>, quietStart: string, minMinutes: number): Array<{ from: string; to: string }> {
  if (!commitments.length || !HHMM.test(quietStart)) return [];
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const latest = commitments.map((c) => c.to).sort().at(-1)!;
  return toMin(quietStart) - toMin(latest) >= minMinutes ? [{ from: latest, to: quietStart }] : [];
}
