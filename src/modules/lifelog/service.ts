import "server-only";
/**
 * «سجل حياتي» — خدمة الخادم (0.5 الجزء أ). كل عنصر يدخل السجل مؤكَّد من صاحبه (أو المربي مع الطفل)، بكلماته، بعد قائمة المنع.
 * لا XP ولا أدلة هنا (life_* لا تنتج أدلة). RLS تفرض من يكتب (المالك، أو مربي الطفل صاحب manage_settings).
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addItem, removeItem, editItem, confirmItem, confirmAll, emptyLog, scenarioSources, LIFE_FIELDS, type LifeField, type LifeLog, type LifeItem, type ItemSource, type IntakeStatus, type ScenarioSource, type BlockReason } from "./rules";

type Db = SupabaseClient;
export type LifeRow = { log: LifeLog; intake_status: IntakeStatus; intake_step: number; intake_followups_used: number; intake_completed_at: string | null; intake_skipped_at: string | null; last_refresh_at: string | null; exists: boolean };
export type LifeResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; blocked?: BlockReason };
const COLS = "roles, responsibilities, dependents, pressures, intake_status, intake_step, intake_followups_used, intake_completed_at, intake_skipped_at, last_refresh_at";
const items = (v: unknown): LifeItem[] => (Array.isArray(v) ? (v as LifeItem[]) : []);

export async function loadLife(db: Db, profileId: string): Promise<LifeRow> {
  const { data } = await db.from("personal_context").select(COLS).eq("profile_id", profileId).maybeSingle();
  if (!data) return { log: emptyLog(), intake_status: "not_started", intake_step: 0, intake_followups_used: 0, intake_completed_at: null, intake_skipped_at: null, last_refresh_at: null, exists: false };
  const d = data as Record<string, unknown>;
  return {
    log: { roles: items(d.roles), responsibilities: items(d.responsibilities), dependents: items(d.dependents), pressures: items(d.pressures) },
    intake_status: d.intake_status as IntakeStatus, intake_step: Number(d.intake_step ?? 0), intake_followups_used: Number(d.intake_followups_used ?? 0),
    intake_completed_at: (d.intake_completed_at as string | null) ?? null, intake_skipped_at: (d.intake_skipped_at as string | null) ?? null, last_refresh_at: (d.last_refresh_at as string | null) ?? null, exists: true,
  };
}

async function save(db: Db, profileId: string, actorId: string, patch: Record<string, unknown>, now: Date): Promise<LifeResult<null>> {
  const { data, error } = await db.from("personal_context").upsert({ profile_id: profileId, ...patch, updated_by: actorId, updated_at: now.toISOString() }, { onConflict: "profile_id" }).select("profile_id");
  if (error) return { ok: false, error: /row-level security|permission denied/.test(error.message) ? "not_allowed" : error.message };
  return data?.length ? { ok: true, data: null } : { ok: false, error: "not_allowed" };
}

/** إضافة عنصر مؤكَّد (يبدأ التعارف إن لم يبدأ). لا يُحفظ شيء ممنوع. */
export async function addLifeItem(db: Db, i: { profileId: string; actorId: string; field: LifeField; text: string; source: ItemSource; now?: Date; id?: string }): Promise<LifeResult<LifeItem>> {
  const now = i.now ?? new Date();
  const row = await loadLife(db, i.profileId);
  const r = addItem(row.log, i.field, i.text, i.source, { id: i.id ?? randomUUID(), now: now.toISOString() });
  if (!r.ok) return { ok: false, error: r.reason, blocked: r.blocked };
  const s = await save(db, i.profileId, i.actorId, { [i.field]: r.log[i.field], ...(row.intake_status === "not_started" || row.intake_status === "skipped" ? { intake_status: "partial" } : {}) }, now);
  return s.ok ? { ok: true, data: r.item } : s;
}
export async function removeLifeItem(db: Db, i: { profileId: string; actorId: string; field: LifeField; id: string; now?: Date }): Promise<LifeResult<null>> {
  const row = await loadLife(db, i.profileId);
  return save(db, i.profileId, i.actorId, { [i.field]: removeItem(row.log, i.field, i.id)[i.field] }, i.now ?? new Date());
}
export async function editLifeItem(db: Db, i: { profileId: string; actorId: string; field: LifeField; id: string; text: string; now?: Date }): Promise<LifeResult<null>> {
  const now = i.now ?? new Date();
  const row = await loadLife(db, i.profileId);
  const r = editItem(row.log, i.field, i.id, i.text, now.toISOString());
  if (!r.ok) return { ok: false, error: r.reason, blocked: r.blocked };
  return save(db, i.profileId, i.actorId, { [i.field]: r.log[i.field] }, now);
}
/** تأكيد عنصر متقادم بلمسة. */
export async function confirmLifeItem(db: Db, i: { profileId: string; actorId: string; field: LifeField; id: string; now?: Date }): Promise<LifeResult<null>> {
  const now = i.now ?? new Date();
  const row = await loadLife(db, i.profileId);
  return save(db, i.profileId, i.actorId, { [i.field]: confirmItem(row.log, i.field, i.id, now.toISOString())[i.field] }, now);
}
/** أ.6 «ما تغيّر»: يجدد last_confirmed_at لكل العناصر ووقت آخر تجديد، ولا يكتب أي محتوى. */
export async function confirmNothingChanged(db: Db, i: { profileId: string; actorId: string; now?: Date }): Promise<LifeResult<null>> {
  const now = i.now ?? new Date();
  const row = await loadLife(db, i.profileId);
  if (!row.exists) return { ok: false, error: "not_found" };
  const log = confirmAll(row.log, now.toISOString());
  return save(db, i.profileId, i.actorId, { ...Object.fromEntries(LIFE_FIELDS.map((f) => [f, log[f]])), last_refresh_at: now.toISOString() }, now);
}
export async function setIntakeStep(db: Db, i: { profileId: string; actorId: string; step: number; now?: Date }): Promise<LifeResult<null>> {
  const row = await loadLife(db, i.profileId);
  return save(db, i.profileId, i.actorId, { intake_step: i.step, ...(row.intake_status === "done" ? {} : { intake_status: "partial" }) }, i.now ?? new Date());
}
/** «ما بدي احكي هلق»: لا إلزام؛ يُعاد السؤال بلطف بعد reask_after_days. */
export async function skipIntake(db: Db, i: { profileId: string; actorId: string; now?: Date }): Promise<LifeResult<null>> {
  const now = i.now ?? new Date();
  return save(db, i.profileId, i.actorId, { intake_status: "skipped", intake_skipped_at: now.toISOString() }, now);
}
/** «تمام» على بطاقة الملخص يثبّت السجل. */
export async function completeIntake(db: Db, i: { profileId: string; actorId: string; now?: Date }): Promise<LifeResult<null>> {
  const now = i.now ?? new Date();
  return save(db, i.profileId, i.actorId, { intake_status: "done", intake_completed_at: now.toISOString(), last_refresh_at: now.toISOString() }, now);
}
export async function countFollowUp(db: Db, i: { profileId: string; actorId: string; now?: Date }): Promise<void> {
  const row = await loadLife(db, i.profileId);
  await save(db, i.profileId, i.actorId, { intake_followups_used: row.intake_followups_used + 1 }, i.now ?? new Date());
}

/** مصادر السيناريو لهذا المستخدم فقط (أ.5): مهام مخططه ذات الموعد ثم عناصر سجله المؤكَّدة. */
export async function scenarioSourcesFor(db: Db, profileId: string, i: { now: Date; today: string }): Promise<{ sources: ScenarioSource[]; intakeStatus: IntakeStatus }> {
  const [row, { data: tasks }] = await Promise.all([
    loadLife(db, profileId),
    db.from("planner_tasks").select("id, title, due_date, status, created_via").eq("profile_id", profileId).eq("status", "open").not("due_date", "is", null),
  ]);
  return { sources: scenarioSources({ plannerTasks: (tasks ?? []) as Array<{ id: string; title: string; due_date: string | null; status: string; created_via: string }>, log: row.log, now: i.now, today: i.today }), intakeStatus: row.intake_status };
}
