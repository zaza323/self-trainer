/**
 * المرحلة 4 على قاعدة بيانات حقيقية: تنبيه الأمان يصل المربي خلال دقيقة (notify_safety)، RLS للمحادثة
 * (view_chat / intervene_chat / الغريب)، إزالة مربٍ أثناء تدخله تعيد handoff، ai_calls للمشرف فقط، الحد اليومي على القاعدة.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { RlsHarness, type TestUser } from "./helpers";
import { pgSupabaseShim } from "./pg-supabase-shim";
import { raiseSafetyFlag } from "../../src/modules/safety/service";
import { runFunction, fakeCaller } from "../../src/modules/companion/runtime";
import { ai } from "../../src/shared/config";

const h = new RlsHarness();
let teen: TestUser, chatGuardian: TestUser, viewGuardian: TestUser, stranger: TestUser, admin: TestUser;
let teenProfile: string, session: string;
let svc: ReturnType<typeof pgSupabaseShim>;

beforeAll(async () => {
  await h.setup();
  svc = pgSupabaseShim(h.pool);
  teen = await h.createUser("t4@test.local");
  chatGuardian = await h.createUser("g4a@test.local");
  viewGuardian = await h.createUser("g4b@test.local");
  stranger = await h.createUser("s4@test.local");
  admin = await h.createUser("a4@test.local", true);
  teenProfile = await h.as(teen, async (q) => (await q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','مراهق','teen') returning id`, [teen.id])).rows[0].id);
  await h.as(stranger, (q) => q(`insert into profiles (user_id, kind, display_name, age_mode) values ($1,'player','غريب','adult')`, [stranger.id]));
  for (const [g, perms] of [[chatGuardian, { view_progress: true, view_chat: true, intervene_chat: true, receive_alerts: true }], [viewGuardian, { view_progress: true, view_chat: true }]] as const) {
    await h.as(g, (q) => q(`insert into profiles (user_id, kind, display_name) values ($1,'guardian','مربٍ')`, [g.id]));
    const code = await h.as(teen, async (q) => (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'father',$3) returning code`, [teenProfile, teen.id, perms])).rows[0].code);
    await h.as(g, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
  }
  session = await h.as(teen, async (q) => (await q(`insert into companion_sessions (profile_id, mode) values ($1,'free') returning id`, [teenProfile])).rows[0].id);
});
afterAll(() => h.teardown());

describe("المحادثة — RLS (AI-4، AI-10، AI-11)", () => {
  it("المتدرب يكتب رسالته؛ لا يستطيع كتابة رسالة ai؛ الغريب لا يرى شيئًا", async () => {
    await h.as(teen, (q) => q(`insert into companion_messages (session_id, role, author_id, content) values ($1,'player',$2,'مرحبا')`, [session, teen.id]));
    expect(await h.failsAs(teen, `insert into companion_messages (session_id, role, author_id, content) values ($1,'ai',$2,'x')`, [session, teen.id])).toMatch(/row-level security/);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from companion_messages`)).rows[0].n)).toBe(0);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from companion_sessions`)).rows[0].n)).toBe(0);
  });
  it("المربي بـ view_chat يرى الخيط ولا يكتب؛ المربي بـ intervene_chat يكتب باسمه ويبدّل handoff", async () => {
    expect(await h.as(viewGuardian, async (q) => (await q(`select count(*)::int as n from companion_messages where session_id = $1`, [session])).rows[0].n)).toBe(1);
    expect(await h.failsAs(viewGuardian, `insert into companion_messages (session_id, role, author_id, content) values ($1,'guardian',$2,'x')`, [session, viewGuardian.id])).toMatch(/row-level security/);
    expect(await h.as(viewGuardian, async (q) => (await q(`update companion_sessions set handoff = 'guardian', handoff_guardian_id = $2 where id = $1`, [session, viewGuardian.id])).rowCount)).toBe(0);
    await h.as(chatGuardian, (q) => q(`update companion_sessions set handoff = 'guardian', handoff_guardian_id = $2, handoff_at = now() where id = $1`, [session, chatGuardian.id]));
    await h.as(chatGuardian, (q) => q(`insert into companion_messages (session_id, role, author_id, content) values ($1,'guardian',$2,'أنا هنا')`, [session, chatGuardian.id]));
    const s = await h.service<{ handoff: string }>(`select handoff from companion_sessions where id = $1`, [session]);
    expect(s.rows[0]!.handoff).toBe("guardian");
  });
  it("إزالة المربي أثناء تدخله → handoff يعود فورًا للمرافق ورسالة نظام في الخيط (القسم 13)", async () => {
    await h.as(teen, (q) => q(`update guardian_links set status = 'removed' where player_id = $1 and guardian_id = $2`, [teenProfile, chatGuardian.id]));
    const s = await h.service<{ handoff: string; handoff_guardian_id: string | null }>(`select handoff, handoff_guardian_id from companion_sessions where id = $1`, [session]);
    expect(s.rows[0]).toEqual({ handoff: "ai", handoff_guardian_id: null });
    const sys = await h.service<{ n: number }>(`select count(*)::int as n from companion_messages where session_id = $1 and role = 'system' and content = 'guardian_removed'`, [session]);
    expect(sys.rows[0]!.n).toBe(1);
  });
});

describe("الأمان (AI-5، GUARD-2، NOTIF-5)", () => {
  it("علم أمان → إشعار فوري لكل مربٍ لديه receive_alerts خلال أقل من دقيقة، والمشرف يراه، والغريب لا", async () => {
    // أعد ربط مربي التنبيهات بعد إزالته أعلاه
    const code = await h.as(teen, async (q) => (await q(`insert into guardian_invites (player_id, invited_by, relation, permissions) values ($1,$2,'mother','{"view_progress":true,"receive_alerts":true}') returning code`, [teenProfile, teen.id])).rows[0].code);
    await h.as(chatGuardian, (q) => q(`select app.accept_guardian_invite($1)`, [code]));
    const t0 = Date.now();
    const r = await raiseSafetyFlag(svc, { profileId: teenProfile, sessionId: session, messageId: null, direction: "inbound", verdict: { safety: { flag: true, category: "self_harm", severity: "high" }, detector: "keywords" } });
    expect(r.notified).toBe(1);
    const n = await h.service<{ created_at: string; payload: Record<string, unknown> }>(`select created_at, payload from notifications where profile_id = $1 and type = 'safety_alert'`, [teenProfile]);
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0]!.payload).toMatchObject({ guardian_id: chatGuardian.id, bypass_limits: true });
    expect(new Date(n.rows[0]!.created_at).getTime() - t0).toBeLessThan(ai.safety.guardian_alert_max_seconds * 1000);
    const f = await h.service<{ notified_at: string | null; status: string }>(`select notified_at, status from safety_flags where id = $1`, [r.flagId]);
    expect(f.rows[0]!.notified_at).not.toBeNull();
    expect(f.rows[0]!.status).toBe("open");
    expect(await h.as(chatGuardian, async (q) => (await q(`select count(*)::int as n from safety_flags`)).rows[0].n)).toBe(1);
    expect(await h.as(viewGuardian, async (q) => (await q(`select count(*)::int as n from safety_flags`)).rows[0].n)).toBe(0);
    expect(await h.as(admin, async (q) => (await q(`select count(*)::int as n from safety_flags`)).rows[0].n)).toBe(1);
    expect(await h.as(stranger, async (q) => (await q(`select count(*)::int as n from safety_flags`)).rows[0].n)).toBe(0);
    expect(await h.failsAs(teen, `select public.notify_safety($1)`, [r.flagId])).toMatch(/permission denied/);
  });
  it("بالغ بلا مربٍ مخوّل → إشعار موارد مساعدة له", async () => {
    const adultProfile = (await h.service<{ id: string }>(`select id from profiles where display_name = 'غريب'`)).rows[0]!.id;
    const r = await raiseSafetyFlag(svc, { profileId: adultProfile, sessionId: null, messageId: null, direction: "inbound", verdict: { safety: { flag: true, category: "abuse", severity: "medium" }, detector: "model" } });
    expect(r.notified).toBe(0);
    const n = await h.service<{ n: number }>(`select count(*)::int as n from notifications where profile_id = $1 and type = 'safety_resources'`, [adultProfile]);
    expect(n.rows[0]!.n).toBe(1);
  });
});

describe("ai_calls (7.3/7.5)", () => {
  it("التسجيل بالإصدار والنموذج، والحد اليومي على القاعدة، والقراءة للمشرف فقط", async () => {
    const schema = z.object({ ok: z.boolean() });
    const n = ai.functions.strategy_normalizer.daily_calls_per_profile!;
    const caller = fakeCaller(Array.from({ length: n + 1 }, () => '{"ok":true}'));
    for (let i = 0; i < n; i++) expect((await runFunction({ db: svc, caller, fn: "strategy_normalizer", profileId: teenProfile, system: "s", messages: [{ role: "user", content: "x" }], schema })).ok).toBe(true);
    expect(await runFunction({ db: svc, caller, fn: "strategy_normalizer", profileId: teenProfile, system: "s", messages: [{ role: "user", content: "x" }], schema })).toEqual({ ok: false, reason: "limit" });
    const row = await h.service<{ prompt_version: string; model_id: string; valid: boolean }>(`select prompt_version, model_id, valid from ai_calls where profile_id = $1 limit 1`, [teenProfile]);
    expect(row.rows[0]).toMatchObject({ model_id: "fake-light", valid: true });
    expect(row.rows[0]!.prompt_version).toBeTruthy();
    expect(await h.as(admin, async (q) => (await q(`select count(*)::int as c from ai_calls`)).rows[0].c)).toBe(n);
    expect(await h.as(teen, async (q) => (await q(`select count(*)::int as c from ai_calls`)).rows[0].c)).toBe(0);
  });
});
