/**
 * محاكاة الحد الأدنى من واجهة supabase-js (from().select/insert/upsert/update + eq/in/gte/order/limit/single)
 * فوق `pg` بصلاحيات service_role، لاختبار خدمات المحرك محليًا بلا PostgREST.
 * أنواع pg تُضبط لتطابق PostgREST: numeric → number، date/timestamptz → نص.
 */
import { Pool, types } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

types.setTypeParser(1700, (v) => parseFloat(v));         // numeric
types.setTypeParser(1082, (v) => v);                      // date
types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
types.setTypeParser(20, (v) => parseInt(v, 10));          // int8

type Filter = { col: string; op: "=" | "<>" | "in" | ">=" | "<=" | ">" | "<" | "is" | "@>"; val: unknown };

const colTypes = new Map<string, Promise<Map<string, string>>>();
async function columnTypes(pool: Pool, table: string): Promise<Map<string, string>> {
  if (!colTypes.has(table)) colTypes.set(table, pool.query(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`, [table]).then((r) => new Map(r.rows.map((x: { column_name: string; data_type: string }) => [x.column_name, x.data_type]))));
  return colTypes.get(table)!;
}

/** سياق مستخدم اختياري: كل استعلام يُنفَّذ داخل معاملة بدور authenticated ومطالبات JWT (كما يفعل PostgREST). */
export type ShimUser = { id: string; email: string; admin?: boolean };
export async function runAs(pool: Pool, user: ShimUser | null, sql: string, params: unknown[]) {
  if (!user) return pool.query(sql, params);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const claims = { sub: user.id, role: "authenticated", email: user.email, app_metadata: user.admin ? { role: "admin" } : {} };
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await client.query("set local role authenticated");
    const r = await client.query(sql, params);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally { client.release(); }
}

class Builder implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private cols = "*";
  private payload: unknown = null;
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private conflict: string | null = null;
  private ignoreDup = false;
  private returning = false;
  constructor(private pool: Pool, private table: string, private user: ShimUser | null = null) {}
  select(cols = "*") { if (this.op === "select") this.cols = cols; else { this.returning = true; this.cols = cols; } return this; }
  insert(p: unknown) { this.op = "insert"; this.payload = p; return this; }
  upsert(p: unknown, o?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.op = "upsert"; this.payload = p; this.conflict = o?.onConflict ?? null; this.ignoreDup = Boolean(o?.ignoreDuplicates); return this; }
  update(p: unknown) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  neq(col: string, val: unknown) { this.filters.push({ col, op: "<>", val }); return this; }
  contains(col: string, val: unknown) { this.filters.push({ col, op: "@>", val }); return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "=", val }); return this; }
  in(col: string, val: unknown[]) { this.filters.push({ col, op: "in", val }); return this; }
  gte(col: string, val: unknown) { this.filters.push({ col, op: ">=", val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ col, op: "<=", val }); return this; }
  lt(col: string, val: unknown) { this.filters.push({ col, op: "<", val }); return this; }
  is(col: string, val: unknown) { this.filters.push({ col, op: "is", val }); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.orderBy = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  single() { this.singleMode = "single"; return this as any; }
  private where(params: unknown[]) {
    if (!this.filters.length) return "";
    return " where " + this.filters.map((f) => {
      if (f.op === "in") { params.push(f.val); return `"${f.col}" = any($${params.length})`; }
      if (f.op === "is") return f.val === null ? `"${f.col}" is null` : `"${f.col}" is ${f.val ? "true" : "false"}`;
      if (f.op === "@>") { params.push(JSON.stringify(f.val)); return `"${f.col}" @> $${params.length}::jsonb`; }
      params.push(f.val); return `"${f.col}" ${f.op} $${params.length}`;
    }).join(" and ");
  }
  private types: Map<string, string> = new Map();
  private val(col: string, v: unknown) {
    const t = this.types.get(col);
    if (t === "jsonb" || t === "json") return v === null ? null : JSON.stringify(v); // كما يرسلها PostgREST
    if (v === null || typeof v !== "object") return v;
    if (t === "ARRAY" && Array.isArray(v)) return v; // مصفوفة PostgreSQL
    return JSON.stringify(v);
  }
  async exec() {
    this.types = await columnTypes(this.pool, this.table);
    const params: unknown[] = [];
    let sql = "";
    if (this.op === "select") {
      sql = `select ${this.cols} from public.${this.table}${this.where(params)}`;
      if (this.orderBy) sql += ` order by "${this.orderBy.col}" ${this.orderBy.asc ? "asc" : "desc"}`;
      if (this.limitN) sql += ` limit ${this.limitN}`;
    } else if (this.op === "insert" || this.op === "upsert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Record<string, unknown>[];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const values = rows.map((r) => `(${cols.map((c) => { params.push(this.val(c, r[c] ?? null)); return `$${params.length}`; }).join(",")})`).join(",");
      sql = `insert into public.${this.table} (${cols.map((c) => `"${c}"`).join(",")}) values ${values}`;
      if (this.op === "upsert") {
        const target = this.conflict ? `(${this.conflict.split(",").map((c) => `"${c.trim()}"`).join(",")})` : "";
        sql += this.ignoreDup ? ` on conflict ${target} do nothing` : ` on conflict ${target} do update set ${cols.map((c) => `"${c}" = excluded."${c}"`).join(",")}`;
      }
      sql += ` returning ${this.cols === "*" ? "*" : this.cols}`;
    } else if (this.op === "delete") {
      sql = `delete from public.${this.table}${this.where(params)} returning ${this.cols === "*" ? "*" : this.cols}`;
    } else {
      const p = this.payload as Record<string, unknown>;
      const sets = Object.entries(p).map(([k, v]) => { params.push(this.val(k, v)); return `"${k}" = $${params.length}`; }).join(",");
      sql = `update public.${this.table} set ${sets}${this.where(params)} returning ${this.cols === "*" ? "*" : this.cols}`;
    }
    try {
      const r = await runAs(this.pool, this.user, sql, params);
      let data: unknown = r.rows;
      if (this.singleMode === "single") { if (r.rows.length !== 1) return { data: null, error: { message: `expected single row, got ${r.rows.length}` } }; data = r.rows[0]; }
      if (this.singleMode === "maybe") data = r.rows[0] ?? null;
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }
  then<R1 = unknown, R2 = never>(onf?: ((v: { data: unknown; error: { message: string } | null }) => R1 | PromiseLike<R1>) | null, onr?: ((r: unknown) => R2 | PromiseLike<R2>) | null) {
    return this.exec().then(onf ?? undefined, onr ?? undefined);
  }
}

export function pgSupabaseShim(pool: Pool, user: ShimUser | null = null): SupabaseClient {
  return { from: (table: string) => new Builder(pool, table, user), rpc: async (fn: string, args: Record<string, unknown> = {}) => {
    const keys = Object.keys(args);
    const vals = keys.map((k) => { const v = args[k]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
    try { const r = await runAs(pool, user, `select public.${fn}(${keys.map((k, i) => `${k} := $${i + 1}`).join(",")}) as v`, vals); return { data: r.rows[0]?.v ?? null, error: null }; }
    catch (e) { return { data: null, error: { message: (e as Error).message } }; }
  } } as unknown as SupabaseClient;
}
