import { customization, catalogEntry, MECHANIC_IDS, CAPABILITY_IDS, type AgeMode } from "@/shared/config";
import { clampValue, validateValue } from "@/modules/settings";

/**
 * قواعد اقتراحات التكيّف (5.8، 7.3، ADAPT-4، ADAPT-5) — خالصة:
 * الأنواع المسموحة فقط، القيمة تُقص ضمن حدود الكتالوج، حد أقصى 2، لا تكرار لاقتراح مرفوض خلال cooldown، والجمهور حسب الوضع.
 */
export type RawSuggestion = { type: string; setting_key: string | null; proposed_value: unknown; reason_short: string; expected_effect: string };
export type Suggestion = RawSuggestion & { audience: "owner" | "guardian"; dedupe_key: string };
export type AdvisorContext = { mode: AgeMode; currentValues: Record<string, unknown>; rejectedKeys: Set<string>; pendingKeys: Set<string>; hasGuardian: boolean };

export function dedupeKeyOf(s: RawSuggestion): string {
  return `${s.type}:${s.setting_key ?? ""}:${JSON.stringify(s.proposed_value ?? null)}`;
}

export function audienceFor(type: string, mode: AgeMode): "owner" | "guardian" {
  const t = customization.adaptation.allowed_types[type];
  if (t?.audience === "guardian_only" || t?.action === "guardian_temporary_support") return "guardian";
  return mode === "child" ? "guardian" : "owner";
}

/** يعيد سبب الرفض أو null. يقص القيمة داخل الكتالوج (7.3). */
export function normalizeSuggestion(raw: RawSuggestion, ctx: AdvisorContext): { ok: true; s: Suggestion } | { ok: false; reason: string } {
  const allowed = customization.adaptation.allowed_types[raw.type];
  if (!allowed) return { ok: false, reason: "type_not_allowed" };
  if ((allowed.setting_key ?? null) !== (raw.setting_key ?? null)) return { ok: false, reason: "setting_key_mismatch" };
  let value = raw.proposed_value;
  if (allowed.setting_key) {
    const entry = catalogEntry(allowed.setting_key);
    if (!entry) return { ok: false, reason: "key_not_in_catalog" };
    value = clampValue(entry, value, ctx.currentValues[allowed.setting_key]);
    const v = validateValue(allowed.setting_key, value);
    if (!v.ok) return { ok: false, reason: v.reason };
    if (JSON.stringify(value) === JSON.stringify(ctx.currentValues[allowed.setting_key])) return { ok: false, reason: "no_change" };
  } else if (raw.type === "try_mechanic") {
    const m = (value as { mechanic?: string } | null)?.mechanic;
    if (!m || !(MECHANIC_IDS as readonly string[]).includes(m)) return { ok: false, reason: "bad_mechanic" };
    value = { mechanic: m };
  } else if (raw.type === "request_more_support") {
    const c = (value as { capability_id?: string } | null)?.capability_id;
    if (!c || !(CAPABILITY_IDS as readonly string[]).includes(c)) return { ok: false, reason: "bad_capability" };
    if (!ctx.hasGuardian) return { ok: false, reason: "no_guardian" };
    value = { capability_id: c };
  } else if (raw.type === "real_mission_idea") {
    const idea = (value as { idea?: string } | null)?.idea;
    if (!idea || !idea.trim()) return { ok: false, reason: "bad_idea" };
    if (!ctx.hasGuardian) return { ok: false, reason: "no_guardian" };
    value = { idea: idea.trim().slice(0, 200) };
  }
  if (!raw.reason_short.trim() || !raw.expected_effect.trim()) return { ok: false, reason: "missing_text" };
  const s: Suggestion = { type: raw.type, setting_key: allowed.setting_key ?? null, proposed_value: value, reason_short: raw.reason_short.trim(), expected_effect: raw.expected_effect.trim(), audience: audienceFor(raw.type, ctx.mode), dedupe_key: "" };
  s.dedupe_key = dedupeKeyOf(s);
  if (ctx.rejectedKeys.has(s.dedupe_key)) return { ok: false, reason: "rejected_recently" };
  if (ctx.pendingKeys.has(s.dedupe_key)) return { ok: false, reason: "already_pending" };
  return { ok: true, s };
}

/** يرشّح مخرج النموذج إلى اقتراحات صالحة (حتى max_suggestions_per_run)، ويعيد أسباب ما رُفض. */
export function filterSuggestions(raws: RawSuggestion[], ctx: AdvisorContext): { accepted: Suggestion[]; rejected: Array<{ raw: RawSuggestion; reason: string }> } {
  const accepted: Suggestion[] = [];
  const rejected: Array<{ raw: RawSuggestion; reason: string }> = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const r = normalizeSuggestion(raw, ctx);
    if (!r.ok) { rejected.push({ raw, reason: r.reason }); continue; }
    if (seen.has(r.s.dedupe_key)) { rejected.push({ raw, reason: "duplicate_in_batch" }); continue; }
    if (accepted.length >= customization.adaptation.max_suggestions_per_run) { rejected.push({ raw, reason: "max_per_run" }); continue; }
    seen.add(r.s.dedupe_key);
    accepted.push(r.s);
  }
  return { accepted, rejected };
}
