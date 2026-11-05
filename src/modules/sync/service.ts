import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { limits, type AgeMode } from "@/shared/config";
import { applyCore, type ClientOpKind, type Found } from "@/modules/missions/core";

/**
 * تطبيق عمليات العميل المؤجلة (المرحلة 6). المفتاح `id` يولّده الجهاز (uuid):
 * إدراجه في client_ops بـ"on conflict do nothing" هو قفل التكرار — إن لم يُدرج فالعملية طُبقت من قبل وتُعاد نتيجتها كما هي.
 * الأدلة وXP والتأمل idempotent أيضًا بقيودها الفريدة (الحالات الحدية: مزامنة مكررة دون اتصال).
 */
export const clientOpSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["complete", "interrupt", "resume", "reflect", "abandon"]),
  mission_id: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()).default({}),
  client_at: z.string().datetime({ offset: true }),
});
export type ClientOp = z.infer<typeof clientOpSchema>;
export const syncBatchSchema = z.object({ ops: z.array(clientOpSchema).min(1).max(limits.offline.sync_batch_max) });

export type OpResult = { id: string; ok: boolean; error?: string; replayed: boolean };

export type SyncDeps = {
  db: SupabaseClient;            // بجلسة المستخدم (RLS)
  admin: () => SupabaseClient;   // service role: سجل client_ops والتقييم
  profileId: string;
  mode: AgeMode;
  loadMission: (missionId: string) => Promise<Found | null>;
  now?: () => Date;
};

/** يقصّ client_at إلى نافذة مقبولة: لا مستقبل، ولا أقدم من client_at_max_age_days. */
export function clampClientAt(clientAt: string, now: Date): string {
  const t = Date.parse(clientAt);
  const min = now.getTime() - limits.offline.client_at_max_age_days * 86400000;
  if (Number.isNaN(t) || t > now.getTime()) return now.toISOString();
  if (t < min) return new Date(min).toISOString();
  return new Date(t).toISOString();
}

export async function applyClientOps(deps: SyncDeps, ops: ClientOp[]): Promise<OpResult[]> {
  const admin = deps.admin();
  const now = (deps.now ?? (() => new Date()))();
  const out: OpResult[] = [];
  for (const op of ops) {
    const clientAt = clampClientAt(op.client_at, now);
    // 1) قفل التكرار: إدراج السجل أولًا
    const { data: inserted, error: insErr } = await admin.from("client_ops")
      .upsert({ id: op.id, profile_id: deps.profileId, kind: op.kind, mission_id: op.mission_id, payload: op.payload, client_at: clientAt }, { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (insErr) { out.push({ id: op.id, ok: false, error: insErr.message, replayed: false }); continue; }
    if (!inserted || (inserted as unknown[]).length === 0) {
      // طُبقت من قبل: أعد النتيجة المحفوظة (أو "قيد التطبيق" إن لم تُحفظ بعد)
      const { data: prev } = await admin.from("client_ops").select("result, profile_id").eq("id", op.id).maybeSingle();
      const r = (prev as { result: { ok: boolean; error?: string } | null; profile_id: string } | null);
      if (!r || r.profile_id !== deps.profileId) { out.push({ id: op.id, ok: false, error: "not_allowed", replayed: true }); continue; }
      out.push({ id: op.id, ok: r.result?.ok ?? false, error: r.result?.error ?? (r.result ? undefined : "pending"), replayed: true });
      continue;
    }
    // 2) التطبيق
    const found = await deps.loadMission(op.mission_id);
    let result: { ok: boolean; error?: string };
    if (!found || found.mission.profile_id !== deps.profileId) result = { ok: false, error: "not_allowed" };
    else {
      const r = await applyCore({ db: deps.db, admin: deps.admin, profileId: deps.profileId, mode: deps.mode, clientAt, now: () => now.getTime() }, found, op.kind as ClientOpKind, op.payload);
      result = r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    await admin.from("client_ops").update({ result, applied_at: now.toISOString() }).eq("id", op.id);
    out.push({ id: op.id, ok: result.ok, error: result.error, replayed: false });
  }
  return out;
}
