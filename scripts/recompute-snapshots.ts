/**
 * MAP-5: إعادة حساب لقطات القدرات من الأدلة (مثلًا بعد تغيير config_version).
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... pnpm recompute [profile_id]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { recomputeSnapshots } from "../src/modules/evidence/service";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const only = process.argv[2];
  const { data } = await admin.from("profiles").select("id").eq("kind", "player");
  for (const p of (data ?? []) as Array<{ id: string }>) {
    if (only && p.id !== only) continue;
    const s = await recomputeSnapshots(admin, p.id);
    console.log(p.id, s.map((x) => `${x.capability_id}=${x.score}/${x.confidence}`).join(" "));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
