import { Client, Pool, type QueryResult } from "pg";
import { resetLocalDb } from "../../scripts/db-reset-local";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/self_trainer_test";

export type TestUser = { id: string; email: string; admin?: boolean };

export class RlsHarness {
  pool!: Pool;

  async setup() {
    await resetLocalDb(DATABASE_URL);
    this.pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  }
  async teardown() {
    await this.pool.end();
  }

  /** استعلام بصلاحيات service_role (يتجاوز RLS) — لتهيئة البيانات والتحقق. */
  async service<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T & Record<string, unknown>>> {
    return this.pool.query(sql, params) as Promise<QueryResult<T & Record<string, unknown>>>;
  }

  async createUser(email: string, admin = false): Promise<TestUser> {
    const r = await this.service<{ id: string }>(
      `insert into auth.users (email, raw_app_meta_data) values ($1, $2) returning id`,
      [email, admin ? { role: "admin" } : {}],
    );
    return { id: r.rows[0]!.id, email, admin };
  }

  /** ينفذ fn داخل معاملة بدور authenticated وبمطالبات JWT للمستخدم (كما يفعل PostgREST). */
  async as<T>(user: TestUser, fn: (q: (sql: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>): Promise<T> {
    const client: Client = (await this.pool.connect()) as unknown as Client;
    try {
      await client.query("begin");
      const claims = { sub: user.id, role: "authenticated", email: user.email, app_metadata: user.admin ? { role: "admin" } : {} };
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await client.query("set local role authenticated");
      const out = await fn((sql, params = []) => client.query(sql, params));
      await client.query("commit");
      return out;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      (client as unknown as { release: () => void }).release();
    }
  }

  /** يُرجع رسالة الخطأ إن فشل الاستعلام بدور المستخدم، أو null إن نجح. */
  async failsAs(user: TestUser, sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await this.as(user, (q) => q(sql, params));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
}
