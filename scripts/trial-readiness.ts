/** المرحلة 8: فحص جاهزية الإطلاق من سطر الأوامر (البيئة، موارد الأمان المتحقق منها، القوالب النشطة). يفشل (exit 1) إن نقص شيء. */
import "dotenv/config";
import { Pool } from "pg";
import { pgSupabaseShim } from "../tests/rls/pg-supabase-shim";
import { readiness } from "../src/modules/trial/service";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL مطلوب"); process.exit(2); }
  const pool = new Pool({ connectionString: url, max: 2 });
  const items = await readiness(pgSupabaseShim(pool), process.env);
  await pool.end();
  for (const i of items) console.log(`${i.ok ? "OK  " : "MISS"} ${i.key}${i.detail ? ` (${i.detail})` : ""}`);
  const missing = items.filter((i) => !i.ok).length;
  console.log(missing === 0 ? "جاهز للتجربة المغلقة." : `${missing} بند ناقص.`);
  process.exit(missing === 0 ? 0 : 1);
}
main();
