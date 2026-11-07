"use server";
/** ح.5: قرار الزيادة (موافق / عدّلها / خليها نفس الوتيرة). child مع increments_require_guardian ⇒ المربي صاحب manage_settings فقط (RPC). */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/db/server";
import { getSession } from "@/modules/accounts";
import { withinCap } from "./rules";

export type Res = { ok: true } | { ok: false; error: string };

export async function decideIncrementAction(_: unknown, form: FormData): Promise<Res> {
  const p = z.object({ id: z.string().uuid(), decision: z.enum(["accepted", "edited", "declined"]), target: z.coerce.number().positive().optional().or(z.literal("")) })
    .safeParse({ id: form.get("id"), decision: form.get("decision"), target: form.get("target") ?? "" });
  if (!p.success) return { ok: false, error: "invalid_input" };
  if (!(await getSession())) return { ok: false, error: "not_allowed" };
  const db = await createClient();
  const target = typeof p.data.target === "number" ? p.data.target : null;
  if (p.data.decision === "edited") {
    if (target === null) return { ok: false, error: "invalid_input" };
    const { data: inc } = await db.from("growth_increments").select("from_value").eq("id", p.data.id).maybeSingle();
    const from = inc?.from_value === null || inc?.from_value === undefined ? null : Number(inc.from_value);
    // ح.9-8: لا تتجاوز الزيادة 25% عن خط الأساس حتى بالتعديل
    if (from !== null && !withinCap(from, target)) return { ok: false, error: "over_cap" };
  }
  const { error } = await db.rpc("decide_increment", { p_id: p.data.id, p_decision: p.data.decision, p_target: target });
  if (error) return { ok: false, error: /not allowed/.test(error.message) ? "not_allowed" : error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
