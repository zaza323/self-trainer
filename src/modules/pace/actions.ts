"use server";
/**
 * ح.5: قرار الزيادة (موافق / عدّلها / خليها نفس الوتيرة). child مع increments_require_guardian ⇒ المربي صاحب manage_settings (RPC).
 * سقف على مرحلتين (config/planner.json.pace.cap): اكتشاف بلا سقف، ثم سقف ناعم يُتجاوز بتأكيد، أو ثابت للطفل حسب pace_cap_mode.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { createAdminClient } from "@/shared/db/admin";
import { getSession } from "@/modules/accounts";
import { localParts } from "@/modules/notifications/plan";
import type { AgeMode } from "@/shared/config";
import { checkTarget, overreachCount, overreachPattern } from "./rules";
import { capContext } from "./service";

export type Res = { ok: true } | { ok: false; error: string; cap?: number; target?: number; pattern?: number | null };
const adminOrNull = () => { try { return createAdminClient(); } catch { return null; } };

export async function decideIncrementAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ id: z.string().uuid(), decision: z.enum(["accepted", "edited", "declined"]), target: z.coerce.number().positive().optional().or(z.literal("")), confirm: z.enum(["yes"]).optional() })
    .safeParse({ id: form.get("id"), decision: form.get("decision"), target: form.get("target") ?? "", confirm: form.get("confirm") ?? undefined });
  if (!p.success) return { ok: false, error: "invalid_input" };
  const session = await getSession();
  if (!session) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const { data: inc } = await db.from("growth_increments").select("profile_id, from_value, target_value").eq("id", p.data.id).maybeSingle();
  if (!inc) return { ok: false, error: "not_allowed" };
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "unavailable" };
  const { data: prof } = await admin.from("profiles").select("id, age_mode, timezone, created_at").eq("id", inc.profile_id as string).maybeSingle();
  if (!prof) return { ok: false, error: "not_allowed" };
  const pr = prof as { id: string; age_mode: AgeMode; timezone: string; created_at: string };
  const ctx = await capContext(admin, pr, localParts(new Date(), pr.timezone).date);
  let overCap = false;
  if (p.data.decision !== "declined") {
    const target = p.data.decision === "edited" ? (typeof p.data.target === "number" ? p.data.target : null) : inc.target_value === null ? null : Number(inc.target_value);
    if (p.data.decision === "edited" && target === null) return { ok: false, error: "invalid_input" };
    if (target !== null) {
      const from = inc.from_value === null ? null : Number(inc.from_value);
      const c = checkTarget({ baseline: from, target, discovery: ctx.discovery, mode: ctx.mode, confirmed: p.data.confirm === "yes" });
      if (!c.allowed) return { ok: false, error: c.reason, cap: c.cap, target, pattern: overreachPattern(ctx.history) ? overreachCount(ctx.history) : null };
      overCap = c.overCap;
    }
  }
  // الكتابة لدور الخدمة فقط (الهجرة 0017)؛ الهوية من جلسة الخادم، والدالة تتحقق من الصلاحية بها
  const { error } = await admin.rpc("decide_increment", { p_actor: session.userId, p_id: p.data.id, p_decision: p.data.decision, p_target: typeof p.data.target === "number" ? p.data.target : null, p_over_cap: overCap, p_discovery: ctx.discovery });
  if (error) return { ok: false, error: /not allowed/.test(error.message) ? "not_allowed" : error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
