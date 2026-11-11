import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { traceText, type Trace, type TraceKind } from "./rules";

/** مقارنة لا تتأثر بترتيب المفاتيح (jsonb يعيد ترتيبها). */
const stable = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k] ?? null]));

export type TraceInput = Trace & { profile_id: string; subject_type?: string | null; subject_id?: string | null };

/** يكتب أثر قرار (بعميل الخدمة فقط؛ المتصفح لا يكتب). لا يكرر الأثر نفسه إن لم يتغير القرار لذات الموضوع. */
export async function recordTrace(admin: SupabaseClient, t: TraceInput, now = new Date()): Promise<boolean> {
  if (t.subject_id) {
    const { data } = await admin.from("decision_traces").select("rule, decision").eq("profile_id", t.profile_id).eq("kind", t.kind).eq("subject_id", t.subject_id).order("created_at", { ascending: false }).limit(1);
    const last = ((data ?? []) as Array<{ rule: string; decision: Record<string, unknown> }>)[0];
    if (last && last.rule === t.rule && stable(last.decision) === stable(t.decision)) return false;
  }
  const { error } = await admin.from("decision_traces").insert({ profile_id: t.profile_id, kind: t.kind, subject_type: t.subject_type ?? null, subject_id: t.subject_id ?? null, rule: t.rule, decision: t.decision, inputs: t.inputs, created_at: now.toISOString() });
  return !error;
}

/** أحدث أثر لقرار ظاهر، مع نص «ليش؟» الجاهز. */
export async function latestTrace(db: SupabaseClient, profileId: string, kind: TraceKind, subjectId?: string | null): Promise<(Trace & { text: string; created_at: string }) | null> {
  let q = db.from("decision_traces").select("kind, rule, decision, inputs, created_at").eq("profile_id", profileId).eq("kind", kind);
  if (subjectId) q = q.eq("subject_id", subjectId);
  const { data } = await q.order("created_at", { ascending: false }).limit(1);
  const row = ((data ?? []) as Array<Trace & { created_at: string }>)[0];
  return row ? { ...row, text: traceText(row) } : null;
}
