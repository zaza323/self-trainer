/**
 * يزامن content/templates/*.json إلى mission_templates/template_capabilities.
 *   pnpm content:sync          → ينفذ على DATABASE_URL
 *   pnpm content:sql           → يطبع SQL فقط
 */
import "dotenv/config";
import { Client } from "pg";
import { loadTemplatesFromContent, buildTemplatesSyncSql } from "../src/modules/library/content";

async function main() {
  const sql = buildTemplatesSyncSql(loadTemplatesFromContent());
  if (process.argv.includes("--print")) { process.stdout.write(sql + "\n"); return; }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  try { await client.query("begin"); await client.query(sql); await client.query("commit"); console.log("templates synced"); }
  catch (e) { await client.query("rollback"); throw e; }
  finally { await client.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
