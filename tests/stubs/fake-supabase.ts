/**
 * قاعدة بيانات وهمية في الذاكرة بواجهة supabase-js المصغّرة (from/select/eq/in/gte/is/order/limit/single/insert/update/upsert/rpc)
 * لاختبارات الوحدة الثابتة لوظائف الذكاء الاصطناعي بلا شبكة ولا PostgreSQL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export class FakeDb {
  tables = new Map<string, Row[]>();
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};
  private seq = 0;
  seed(table: string, rows: Row[]) { this.tables.set(table, [...(this.tables.get(table) ?? []), ...rows.map((r) => ({ id: r.id ?? this.nextId(), created_at: new Date().toISOString(), ...r }))]); return this; }
  rows(table: string) { return this.tables.get(table) ?? []; }
  nextId() { this.seq++; return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`; }
  client(): SupabaseClient {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    class B {
      private filters: Filter[] = []; private op: "select" | "insert" | "update" | "upsert" | "delete" = "select"; private payload: unknown = null;
      private singleMode: "single" | "maybe" | null = null; private orderBy: { col: string; asc: boolean } | null = null; private limitN: number | null = null;
      private conflict: string[] | null = null; private ignoreDup = false;
      constructor(private table: string) {}
      select() { return this; }
      insert(p: unknown) { this.op = "insert"; this.payload = p; return this; }
      upsert(p: unknown, o?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.op = "upsert"; this.payload = p; this.conflict = o?.onConflict?.split(",").map((s) => s.trim()) ?? null; this.ignoreDup = Boolean(o?.ignoreDuplicates); return this; }
      update(p: unknown) { this.op = "update"; this.payload = p; return this; }
      delete() { this.op = "delete"; return this; }
      neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
      lte(c: string, v: unknown) { this.filters.push((r) => String(r[c]) <= String(v)); return this; }
      eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
      in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this; }
      gte(c: string, v: unknown) { this.filters.push((r) => String(r[c]) >= String(v)); return this; }
      lt(c: string, v: unknown) { this.filters.push((r) => String(r[c]) < String(v)); return this; }
      gt(c: string, v: unknown) { this.filters.push((r) => String(r[c]) > String(v)); return this; }
      not(c: string, op: string, v: unknown) { this.filters.push((r) => (op === "is" ? !(v === null ? r[c] === null || r[c] === undefined : r[c] === v) : r[c] !== v)); return this; }
      or(expr: string) { const parts = expr.split(",").map((p) => p.split(".")); this.filters.push((r) => parts.some(([c, op, ...rest]) => { const v = rest.join("."); const x = r[c!]; if (op === "is") return v === "null" ? x === null || x === undefined : String(x) === v; if (op === "gt") return String(x) > v; if (op === "lt") return String(x) < v; return String(x) === v; })); return this; }
      is(c: string, v: unknown) { this.filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
      order(c: string, o?: { ascending?: boolean }) { this.orderBy = { col: c, asc: o?.ascending !== false }; return this; }
      limit(n: number) { this.limitN = n; return this; }
      maybeSingle() { this.singleMode = "maybe"; return this; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      single() { this.singleMode = "single"; return this as any; }
      private matches() { return self.rows(this.table).filter((r) => this.filters.every((f) => f(r))); }
      private finish(rows: Row[]) {
        if (this.orderBy) { const { col, asc } = this.orderBy; rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1)); }
        if (this.limitN) rows = rows.slice(0, this.limitN);
        if (this.singleMode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected 1 row, got ${rows.length}` } };
        if (this.singleMode === "maybe") return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
      }
      exec() {
        const all = self.tables.get(this.table) ?? [];
        if (!self.tables.has(this.table)) self.tables.set(this.table, all);
        if (this.op === "select") return this.finish(this.matches());
        if (this.op === "update") { const m = this.matches(); for (const r of m) Object.assign(r, this.payload as Row); return this.finish(m); }
        if (this.op === "delete") { const m = this.matches(); self.tables.set(this.table, all.filter((r) => !m.includes(r))); return this.finish(m); }
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const out: Row[] = [];
        for (const r of incoming) {
          const row: Row = { id: self.nextId(), created_at: new Date().toISOString(), ...r };
          const dup = this.conflict ? all.find((x) => this.conflict!.every((c) => x[c] === row[c])) : null;
          if (dup) { if (!this.ignoreDup) Object.assign(dup, row); continue; }
          all.push(row); out.push(row);
        }
        return this.finish(out);
      }
      then<R>(onf?: ((v: unknown) => R) | null) { return Promise.resolve(this.exec()).then(onf ?? undefined); }
    }
    return {
      from: (t: string) => new B(t),
      rpc: async (fn: string, args: Record<string, unknown> = {}) => { const h = self.rpcs[fn]; return h ? { data: await h(args), error: null } : { data: null, error: { message: `rpc ${fn} missing` } }; },
    } as unknown as SupabaseClient;
  }
}
