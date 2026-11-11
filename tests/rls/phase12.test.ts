/**
 * المرحلة 12 (0.5 الجزء ج) على قاعدة بيانات حقيقية:
 *  ج.5-2 مخرج ذكاء اصطناعي خبيث (XP، درجة، دعم، إعداد، هامش، مكافأة) لا يغيّر أي جدول ممنوع.
 *  ج.5-5 الرحلات J1–J9 بالعلم AI_ENABLED=false (طبقة الخادم). J2 (التعارف) مختبرة في tests/rls/phase13.test.ts.
 *  ج.5-7 اقتراح pending لا يغيّر شيئًا قبل الموافقة، وينتهي بعد expire_after_days.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { ai, customization } from "../../src/shared/config";
import { fakeCaller } from "../../src/modules/companion/runtime";
import { anthropicCaller } from "../../src/lib/ai/client";
import { narrate, weeklySummary } from "../../src/modules/companion/functions/narrator-summary-normalizer";
import { goalBuilderTurn } from "../../src/modules/companion/functions/goal-builder";
import { handlePlayerMessage, getOrCreateSession } from "../../src/modules/companion/chat/service";
import { runAdvisorForProfile, expireSuggestions } from "../../src/modules/adaptation/service";
import { evaluateAndRecord } from "../../src/modules/evidence/service";
import { ensureDailySuggestions } from "../../src/modules/engine/service";
import { taskBreakdown, dayPlanner, dayReconstructor } from "../../src/modules/planner/ai";
import { createTask } from "../../src/modules/planner/service";
import { parseQuickAdd } from "../../src/modules/planner/nlp";
import { loadStartScreen } from "../../src/modules/moments/service";
import { restSuggestionsFor } from "../../src/modules/rest/service";
import { classifyText, safeResponse, raiseSafetyFlag } from "../../src/modules/safety/service";
import { planForProfile } from "../../src/modules/notifications/service";
import { setSetting } from "../../src/modules/settings/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileRow } from "../../src/shared/db/types";

const h = new RlsHarness();
const TZ = "Asia/Amman";
let teen: TestUser, creator: TestUser, childUser: TestUser, adult: TestUser;
let teenP: string, childP: string, adultP: string;
let svc: SupabaseClient, teenDb: SupabaseClient;
const P = (id: string, mode: "child" | "teen" | "adult", user: TestUser) => ({ id, user_id: user.id, age_mode: mode, display_name: "x", kind: "player", timezone: TZ });

/** جداول ai.json › boundary.forbidden_write_targets بأسمائها الفعلية (الموجود منها الآن؛ هوامش الوقت في المرحلة 14). */
const FORBIDDEN_TABLES: Record<string, string[]> = {
  xp_events: ["xp_events"], evidence_events: ["evidence_events"], capability_scores: ["capability_states"], capability_snapshots: ["capability_snapshots"],
  support_level_changes: ["capability_states"], incentive_stage_changes: ["profiles"], settings: ["settings"], settings_audit: ["settings_audit"],
  rewards: ["rewards"], real_rewards: ["rewards"], margin_events: ["margin_events"], margin_rules: ["margin_rules"], guardian_links: ["guardian_links"],
  missions: ["missions"], planner_tasks: ["planner_tasks"], goals: ["goals"],
};
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of new Set(Object.values(FORBIDDEN_TABLES).flat())) {
    const exists = (await h.service<{ r: string | null }>(`select to_regclass($1)::text as r`, [`public.${t}`])).rows[0]!.r;
    if (!exists) continue;
    out[t] = (await h.service<{ m: string }>(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as m from public.${t} x`)).rows[0]!.m;
  }
  return out;
}

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  teen = await h.createUser("t12@test.local"); creator = await h.createUser("c12@test.local"); childUser = await h.createUser("child12@child.local"); adult = await h.createUser("a12@test.local");
  teenP = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','مراهق','teen',$2) returning id`, [teen.id, TZ])).rows[0].id);
  await h.as(creator, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','مربي')`, [creator.id]));
  childP = (await h.service<{ id: string }>(`select app.create_child_profile($1,$2,'طفل','k12','mother','2026-11-05.1') as id`, [childUser.id, creator.id])).rows[0]!.id;
  adultP = await h.as(adult, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode, timezone) values ($1,'player','بالغ','adult',$2) returning id`, [adult.id, TZ])).rows[0].id);
  teenDb = pgSupabaseShim(h.pool, teen);
});
afterAll(() => h.teardown());

describe("ج.5-2: مخرج ذكاء اصطناعي خبيث لا يغيّر أي جدول ممنوع", () => {
  const evil = { xp: 500, support_level: 3, score: 100, gate2: "shown", settings: { daily_mission_count: 3 }, margin_min: 999, reward: { status: "earned" }, incentive_stage: 4 };
  const EVIL_KEYS = Object.keys(evil);
  const safe = JSON.stringify({ flag: false, category: null, severity: null });
  /** صفوف ai_calls لوظيفة: يثبت أن المخرج وصل فعلًا إلى الخادم */
  const calls = async (fn: string) => (await h.service<{ valid: boolean; error: string | null; output: Record<string, unknown> | null }>(`select valid, error, output from ai_calls where profile_id = $1 and function = $2 order by created_at`, [teenP, fn])).rows;
  const stripped = (rows: Array<{ valid: boolean; output: Record<string, unknown> | null }>) => rows.filter((r) => r.valid).every((r) => EVIL_KEYS.every((k) => !(k in (r.output ?? {}))));

  it("مخرجات مهيكلة تحمل حقولًا خبيثة: تصل، تُقبل بنيتها المسموحة فقط، والحقول الخبيثة تُسقط قبل أي استعمال", async () => {
    const before = await snapshot();
    const n = await narrate({ db: svc, caller: fakeCaller([JSON.stringify({ ...evil, narrative: "أحسنت", highlighted_capability: "attention" })]), profileId: teenP, mode: "teen", facts: { done: 1 }, fixedLines: ["ثابت"] });
    expect(n.source).toBe("ai"); expect(EVIL_KEYS.some((k) => k in (n as object))).toBe(false);
    const w = await weeklySummary({ db: svc, caller: fakeCaller([JSON.stringify({ ...evil, improved: ["الانتباه"], needs_support: [], guardian_tip: "شجّعه" })]), profileId: teenP, mode: "teen", stats: {} });
    expect(w.source).toBe("ai");
    const b = await taskBreakdown({ db: svc, caller: fakeCaller([JSON.stringify({ ...evil, steps: [{ title: "خطوة", estimate_min: 5, xp: 500 }], note: null })]), profileId: teenP, mode: "teen", level: "L1_hint", task: { title: "مشروع", notes: null }, userSteps: [] });
    expect(b.source).toBe("ai"); expect(b.steps).toEqual([{ title: "خطوة", estimate_min: 5 }]);
    const d = await dayReconstructor({ db: svc, caller: fakeCaller([JSON.stringify({ ...evil, blocks: [], gaps: [] })]), profileId: teenP, mode: "teen", text: "صحيت 9", categories: ["sleep"], knownBoundaries: [], nowHHMM: null });
    expect(d.source).toBe("ai");
    for (const fn of ["progress_narrator", "weekly_summary", "task_breakdown", "day_reconstructor"]) {
      const rows = await calls(fn);
      expect(rows.filter((r) => r.valid), fn).toHaveLength(1);   // وصل وسُجّل
      expect(stripped(rows), fn).toBe(true);                     // بلا الحقول الخبيثة
    }
    expect(await snapshot()).toEqual(before);
  });

  it("المستشار: نوع ممنوع يُرفض (صف ai_calls غير صالح)، وقيمة خارج الكتالوج تُحفظ اقتراحًا معلّقًا مقصوصًا، ولا يُطبَّق شيء", async () => {
    const before = await snapshot();
    const cat = customization.catalog.daily_mission_count as { min: number; max: number };
    await h.service(`delete from adaptation_suggestions where profile_id = $1`, [teenP]);
    // (أ) نوع غير موجود في الكتالوج «grant_xp» مرتين (المحاولة وإعادتها) ⇒ مرفوض كليًا
    const bad = JSON.stringify({ suggestions: [{ type: "grant_xp", setting_key: null, proposed_value: { xp: 500 }, reason_short: "x", expected_effect: "y" }] });
    const r1 = await runAdvisorForProfile(svc, fakeCaller([bad, bad]), P(teenP, "teen", teen), new Date("2026-11-09T09:00:00Z"));
    expect(r1.created).toEqual([]);
    const rejected = (await calls("adaptation_advisor")).filter((r) => !r.valid);
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(rejected.every((r) => r.error === "type_not_allowed")).toBe(true);
    expect((await h.service<{ n: number }>(`select count(*)::int as n from adaptation_suggestions where profile_id = $1`, [teenP])).rows[0]!.n).toBe(0);
    // (ب) نوع مسموح بقيمة خبيثة −50 مع حقول إضافية ⇒ اقتراح معلّق واحد مقصوص إلى الحد الأدنى
    const clip = JSON.stringify({ ...evil, suggestions: [{ ...evil, type: "change_daily_count", setting_key: "daily_mission_count", proposed_value: -50, reason_short: "x", expected_effect: "y" }] });
    const r2 = await runAdvisorForProfile(svc, fakeCaller([clip]), P(teenP, "teen", teen), new Date("2026-11-10T10:00:00Z")); // يوم تالٍ: حد المستشار استدعاء واحد يوميًا
    expect(r2.created).toHaveLength(1);
    const rows = (await h.service<{ decision: string | null; proposed_value: number; type: string }>(`select decision, proposed_value, type from adaptation_suggestions where profile_id = $1`, [teenP])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBeNull(); expect(Number(rows[0]!.proposed_value)).toBe(cat.min); expect(rows[0]!.type).toBe("change_daily_count");
    // لم يُطبَّق: الإعداد الفعّال كما هو، والجداول الممنوعة كما هي
    expect((await h.service<{ v: unknown }>(`select app.setting_effective($1,'daily_mission_count') as v`, [teenP])).rows[0]!.v).toBe((customization.catalog.daily_mission_count as { default: { teen: number } }).default.teen);
    expect(await snapshot()).toEqual(before);
  });

  it("المحادثة الحرة: تحليل خبيث (قدرة غير موجودة + حقول XP) يُرفض بصف ai_calls غير صالح ولا يكتب أدلة ولا مؤشرات", async () => {
    const before = await snapshot();
    const sess = await getOrCreateSession(teenDb, teenP, "free");
    const { data: msg } = await teenDb.from("companion_messages").insert({ session_id: sess.id, role: "player", author_id: teen.id, content: "مرحبا" }).select("id").single();
    const evilAnalysis = JSON.stringify({ ...evil, insights: [{ capability_id: "xp_events", type: "hack", value: 99, confidence: 5 }], needs_human: { flag: false, reason: null }, safety: { flag: false, category: null, severity: null }, context_suggestion: null });
    const r = await handlePlayerMessage(svc, fakeCaller([safe, "أهلًا، شو ببالك؟", safe, evilAnalysis, evilAnalysis]),
      { profileId: teenP, mode: "teen", support: "L1_hint", viewers: [], memory: { insights: [], lastSummary: null, personalContext: null } }, sess.id, (msg as { id: string }).id, "مرحبا");
    expect(r.kind).toBe("reply");
    const chat = await calls("companion_chat");
    expect(chat.some((c) => c.valid)).toBe(true);                       // الرد نفسه وصل
    expect(chat.filter((c) => !c.valid).length).toBeGreaterThanOrEqual(1); // التحليل الخبيث وصل ورُفض
    expect((await h.service<{ n: number }>(`select count(*)::int as n from companion_insights where profile_id = $1`, [teenP])).rows[0]!.n).toBe(0);
    expect(await snapshot()).toEqual(before);
  });
});

describe("ج.5-7: الاقتراح المعلّق", () => {
  it("لا يغيّر الإعداد قبل الموافقة، وينتهي بعد expire_after_days", async () => {
    const before = await snapshot();
    const now = new Date("2026-11-09T09:00:00Z");
    await h.service(`delete from adaptation_suggestions where profile_id = $1`, [adultP]);
    const r = await runAdvisorForProfile(svc, { enabled: false } as never, P(adultP, "adult", adult), now, [{ type: "change_daily_count", setting_key: "daily_mission_count", proposed_value: 1, reason_short: "r", expected_effect: "e" }]);
    expect(r.created).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
    const eff = await h.service<{ v: unknown }>(`select app.setting_effective($1,'daily_mission_count') as v`, [adultP]);
    expect(eff.rows[0]!.v).toBe((customization.catalog.daily_mission_count as { default: { adult: number } }).default.adult);
    expect(await expireSuggestions(svc, new Date(now.getTime() + (customization.adaptation.expire_after_days - 1) * 86400000))).toBe(0);
    expect(await expireSuggestions(svc, new Date(now.getTime() + (customization.adaptation.expire_after_days + 1) * 86400000))).toBeGreaterThanOrEqual(1);
    expect((await h.service<{ decision: string }>(`select decision from adaptation_suggestions where profile_id = $1`, [adultP])).rows[0]!.decision).toBe("expired");
    expect(await snapshot()).toEqual(before);
  });
});

describe("ج.5-5: الرحلات بالعلم AI_ENABLED=false (طبقة الخادم)", () => {
  const prevFlag = process.env[ai.ai_off.flag_env], prevKey = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { process.env[ai.ai_off.flag_env] = "false"; process.env.ANTHROPIC_API_KEY = "dummy-key-flag-test"; });
  afterAll(() => { if (prevFlag === undefined) delete process.env[ai.ai_off.flag_env]; else process.env[ai.ai_off.flag_env] = prevFlag; if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });
  const off = () => { const c = anthropicCaller(); expect(c.enabled).toBe(false); return c; };

  it("J1 إنشاء حساب في كل وضع عمري", async () => {
    off();
    const modes = (await h.service<{ age_mode: string }>(`select age_mode from profiles where id = any($1)`, [[childP, teenP, adultP]])).rows.map((r) => r.age_mode).sort();
    expect(modes).toEqual(["adult", "child", "teen"]);
  });
  // J2 (التعارف وسجل الحياة بالنموذج الثابت) مختبرة في tests/rls/phase13.test.ts «أ.10-8 (J2) و9».
  it("J3 بناء غاية بأسئلة ثابتة، والحفظ بيد المستخدم", async () => {
    const r = await goalBuilderTurn({ db: svc, caller: off(), profileId: teenP, mode: "teen", history: [], userMessage: "بدي أتحسن بالدراسة", draft: null, turn: 1 } as never);
    expect(r.source).toBe("fixed"); expect(r.output.next_question).toBeTruthy();
    await h.as(teen, (q) => q(`insert into goals (profile_id, title) values ($1, 'أتحسن بالدراسة')`, [teenP]));
    expect((await h.service<{ n: number }>(`select count(*)::int as n from goals where profile_id = $1`, [teenP])).rows[0]!.n).toBeGreaterThanOrEqual(1);
  });
  it("J4 دورة مهمة كاملة: اقتراح بالقواعد، تأمل بأسئلة القالب، بوابتان، وعي نصي ثابت", async () => {
    off();
    const prof = (await h.service<ProfileRow>(`select * from profiles where id = $1`, [teenP])).rows[0]!;
    await ensureDailySuggestions(teenDb, prof);
    const mid = (await h.service<{ id: string }>(`select id from missions where profile_id = $1 order by created_at limit 1`, [teenP])).rows[0]!.id;
    await h.as(teen, async (q) => {
      await q(`select app.transition_mission($1,'chosen')`, [mid]); await q(`update missions set strategy_chosen = 's1', time_estimate = 5 where id = $1`, [mid]);
      await q(`select app.transition_mission($1,'planned')`, [mid]); await q(`select app.transition_mission($1,'in_progress')`, [mid]);
      await q(`select app.transition_mission($1,'completed')`, [mid]);
      await q(`insert into reflections (mission_id, prompts_and_answers) values ($1,'[{"prompt":"س","answer":"ج"}]')`, [mid]);
      await q(`select app.transition_mission($1,'reflected')`, [mid]);
    });
    const ev = await evaluateAndRecord(svc, mid);
    const m = (await h.service<{ gate1: boolean | null; gate2: string | null }>(`select gate1, gate2 from missions where id = $1`, [mid])).rows[0]!;
    expect(m.gate1).not.toBeNull(); expect(m.gate2).not.toBeNull(); expect(ev).toBeTruthy();
    const n = await narrate({ db: svc, caller: off(), profileId: teenP, mode: "teen", facts: { gate2: m.gate2 }, fixedLines: ["نص ثابت"] });
    expect(n).toMatchObject({ source: "fixed", lines: ["نص ثابت"] });
  });
  it("J5 المخطط: المحلّل القاعدي، تقسيم وترتيب يدويان أو حتميان", async () => {
    const parsed = parseQuickAdd("اجتماع بكرا الساعة 5 #عمل", { today: "2026-11-09", ambiguousPmUntil: 7, weekStart: "sat" });
    expect(parsed.due_time).toBe("17:00");
    const t = await createTask(teenDb, { profileId: teenP, title: parsed.title, due_date: parsed.due_date, weekStart: "sat", tz: TZ } as never);
    expect(t.ok).toBe(true);
    expect((await taskBreakdown({ db: svc, caller: off(), profileId: teenP, mode: "teen", level: "L1_hint", task: { title: "مشروع", notes: null }, userSteps: [] })).source).toBe("fixed");
    expect(await dayPlanner({ db: svc, caller: off(), profileId: teenP, mode: "teen", level: "L1_hint", tasks: [{ id: "00000000-0000-4000-8000-000000000001", title: "x", priority: "high", due_date: "2026-11-09", due_time: null, estimate_min: 20 }], today: "2026-11-09", nowMin: 540, busy: [] })).toMatchObject({ ok: true, source: "deterministic" });
  });
  it("J6 شاشة البداية واللحظات والراحة بلا ذكاء اصطناعي", async () => {
    off();
    const p = { ...P(teenP, "teen", teen) } as never;
    const s = await loadStartScreen(teenDb, p, { now: new Date("2026-11-09T06:00:00Z"), safetyPending: false, comeback: false, followupsPending: 0 });
    expect(s.decision).toBeTruthy();
    const rest = await restSuggestionsFor(teenDb, p, new Date("2026-11-09T06:00:00Z"), { source: "manual", gapMin: 30 });
    expect(rest.shown.length).toBeGreaterThan(0);
  });
  it("J7 لوحة المربي: مهمة، مكافأة، إعدادات", async () => {
    off();
    await h.as(creator, (q) => q(`insert into missions (profile_id, template_id, template_version, difficulty, support_level, source, created_by) values ($1,'rd-sim-01',1,2,'L0_instruct','guardian',$2)`, [childP, creator.id]));
    await h.service(`select public.reward_create($1,$2,'نزهة',null,null,'transfer_reports','{"count":2}'::jsonb,'active')`, [creator.id, childP]);
    const r = await setSetting(pgSupabaseShim(h.pool, creator), { profileId: childP, key: "daily_mission_count", value: 1, role: "guardian" });
    expect(r.ok).toBe(true);
  });
  it("J8 الإشعارات المتكيّفة والملخص الرقمي الثابت", async () => {
    const planned = await planForProfile(svc, { ...P(teenP, "teen", teen) } as never, new Date("2026-11-09T09:00:00Z"));
    expect(planned).toBeGreaterThanOrEqual(0);
    const w = await weeklySummary({ db: svc, caller: off(), profileId: childP, mode: "child", stats: { reflected: 3 } });
    expect(w.source).toBe("fixed");
  });
  it("J9 الأمان: قوائم الكلمات فقط بسلوك متحفظ ⇒ رد آمن + تنبيه المربي", async () => {
    const v = await classifyText(svc, off(), childP, "ما بدي أعيش", "inbound");
    expect(v.safety.flag).toBe(true); expect(v.detector).toBe("keywords");
    expect(safeResponse(v.safety.category!, "child").length).toBeGreaterThan(0);
    const r = await raiseSafetyFlag(svc, { profileId: childP, sessionId: null, messageId: null, direction: "inbound", verdict: v });
    expect(r.notified).toBeGreaterThanOrEqual(1);
  });
});
