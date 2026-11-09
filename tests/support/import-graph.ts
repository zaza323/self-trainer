/**
 * أداة اختبار حدود الوحدات (0.5 ج.3): تتبع الاستيرادات تعديًا مع اختصارات tsconfig (@/ و@content/ و@config/ و@tests/)،
 * وتكشف كتابات قاعدة البيانات واستدعاءات الوقت والعشوائية. تحليل نصي حتمي، بلا تنفيذ للكود.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "../..");
const ALIASES: Array<[string, string]> = [["@/", "src/"], ["@content/", "content/"], ["@config/", "config/"], ["@tests/", "tests/"]];
const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx", ""];

export const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

/** يزيل التعليقات والنصوص المقتبسة كي لا تُحسب «new Date()» داخل تعليق. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** الاستيرادات مع علم «نوعي فقط» (import type لا يُنفَّذ). */
export function importSpecifiers(src: string, runtimeOnly = false): string[] {
  const clean = stripComments(src);
  const out = new Set<string>();
  // import/export ... from "x"  (المقطع بين الكلمة وfrom لا يحوي ; )
  for (const m of clean.matchAll(/\b(import|export)\s+(type\s+)?([^;'"`]*?)\s*from\s*["']([^"']+)["']/g)) {
    const typeOnly = Boolean(m[2]) || /^\{\s*(type\s+[^,}]+\s*,?\s*)+\}$/.test((m[3] ?? "").trim());
    if (!runtimeOnly || !typeOnly) out.add(m[4]!);
  }
  for (const m of clean.matchAll(/\bimport\s*["']([^"']+)["']/g)) out.add(m[1]!);        // import "x" (أثر جانبي)
  for (const m of clean.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]!); // import("x")
  return [...out];
}
const runtimeSpecifiers = (src: string) => importSpecifiers(src, true);

export function resolveSpecifier(spec: string, fromAbs: string): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(fromAbs), spec);
  else for (const [a, t] of ALIASES) if (spec.startsWith(a)) base = path.join(ROOT, t, spec.slice(a.length));
  if (!base) return null; // حزمة خارجية
  for (const e of EXTS) { const p = base + e; if (existsSync(p) && statSync(p).isFile()) return p; }
  return null;
}

export type Graph = { files: Set<string>; packages: Map<string, string[]>; edges: Map<string, string[]> };

/** كل الملفات (المحلية) والحزم الخارجية التي يصل إليها الدخول تعديًا (استيرادات وقت التشغيل فقط). */
export function closure(entries: string[], opts: { stopAt?: (relPath: string) => boolean } = {}): Graph {
  const files = new Set<string>(), packages = new Map<string, string[]>(), edges = new Map<string, string[]>();
  const stack = entries.map((e) => path.resolve(ROOT, e));
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    const kids: string[] = [];
    for (const s of runtimeSpecifiers(src)) {
      const r = resolveSpecifier(s, f);
      if (r) { kids.push(r); if (!opts.stopAt?.(rel(r))) stack.push(r); else files.add(r); }
      else if (!s.startsWith(".") && !s.startsWith("@/") && !s.startsWith("@content/")) packages.set(s, [...(packages.get(s) ?? []), rel(f)]);
    }
    edges.set(f, kids);
  }
  return { files, packages, edges };
}

/** كتابات قاعدة البيانات في ملف: from("t").insert|update|upsert|delete، وrpc لدوال كاتبة. */
export function dbWrites(src: string): Array<{ table: string; op: string }> {
  const out: Array<{ table: string; op: string }> = [];
  for (const m of stripComments(src).matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)[\s\S]{0,400}?\.(insert|update|upsert|delete)\(/g)) {
    // نتأكد أن السلسلة نفسها (لا استعلام لاحق) — لا ";" بين from والعملية
    const seg = m[0];
    if (!seg.slice(0, seg.lastIndexOf(".")).includes(";")) out.push({ table: m[1]!, op: m[2]! });
  }
  for (const m of stripComments(src).matchAll(/\.rpc\(\s*["'`]([a-z_]+)["'`]/g)) out.push({ table: `rpc:${m[1]}`, op: "rpc" });
  return out;
}

export const NONDETERMINISM = /\bMath\.random\s*\(|\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/g;
export function nondeterministicCalls(src: string): string[] { return [...stripComments(src).matchAll(NONDETERMINISM)].map((m) => m[0]); }

export const readRel = (p: string) => readFileSync(path.resolve(ROOT, p), "utf8");
