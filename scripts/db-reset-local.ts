/**
 * يعيد بناء قاعدة الاختبار المحلية: ينشئها، يطبّق المحاكاة (auth shim)، الهجرات، ثم يزامن الإعدادات.
 * يُستخدم في CI وفي pnpm test:rls.
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { buildConfigSyncSql } from "../src/shared/config/sync-sql";
import { loadTemplatesFromContent, buildTemplatesSyncSql } from "../src/modules/library/content";

export async function resetLocalDb(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName]);
  await admin.query(`drop database if exists "${dbName}"`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const root = path.resolve(__dirname, "..");
  await db.query(readFileSync(path.join(root, "tests/rls/auth-shim.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(path.join(dir, f), "utf8"));
  }
  await db.query(buildConfigSyncSql());
  await db.query(buildTemplatesSyncSql(loadTemplatesFromContent(path.join(root, "content/templates"))));
  await db.end();
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  resetLocalDb(url)
    .then(() => console.log("local db reset:", url))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
