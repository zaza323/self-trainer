/**
 * يزامن config/customization.json و content/capabilities.ar.json و content/mechanics.ar.json
 * إلى جداول settings_catalog / config_meta / capabilities / mechanics.
 *   pnpm config:sync          → ينفذ على DATABASE_URL
 *   pnpm config:sql           → يطبع SQL فقط (لتنفيذه على Supabase عبر SQL editor أو supabase db)
 * لا أرقام في SQL الهجرات: كل القيم تأتي من هنا.
 */
import "dotenv/config";
import { Client } from "pg";
import { buildConfigSyncSql } from "../src/shared/config/sync-sql";

async function main() {
  const sql = buildConfigSyncSql();
  if (process.argv.includes("--print")) {
    process.stdout.write(sql + "\n");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("config synced");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
