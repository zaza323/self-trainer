/**
 * 0.5 ج.5-1 و ج.3: حدود الوحدات تُفرض باختبار لا بالاتفاق.
 * RULES-1: المحرك (src/lib/engine/index.ts وكل ما يستورده تعديًا) لا يصل إلى طبقة الذكاء الاصطناعي ولا حزمة النموذج ولا قاعدة البيانات.
 * RULES-2: حزمة النموذج في src/lib/ai/client.ts وحده؛ وطبقة الذكاء الاصطناعي لا تكتب إلا في الجداول المسموحة ولا تستورد كاتبًا.
 * RULES-5: لا Math.random ولا Date.now ولا new Date() في ملفات المحرك.
 * ويتأكد الاختبار أن المدقق نفسه يفشل على ملفات مخالفة عمدًا (tests/fixtures/boundary).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { closure, rel, readRel, dbWrites, nondeterministicCalls, importSpecifiers, resolveSpecifier, stripComments, ROOT } from "@tests/support/import-graph";
import { AI_LAYER_FILES, AI_BARRELS, AI_LAYER_PATTERNS, AI_ORCHESTRATORS, SDK_PACKAGES, SDK_ALLOWED_FILE } from "./ai/layer";
import { ai } from "@/shared/config";
import engineManifest from "./engine/files.json";

const ENGINE_ENTRY = "src/lib/engine/index.ts";
const AI = new Set<string>(AI_LAYER_FILES);
const boundary = (ai as unknown as { boundary: { allowed_write_targets: string[]; forbidden_write_targets: string[] } }).boundary;
/** «ai_suggestions_via_adaptation_suggestions» ⇒ الجدول adaptation_suggestions */
export const ALLOWED_TABLES = new Set(boundary.allowed_write_targets.map((t) => t.replace(/^.*_via_/, "")));
const FORBIDDEN_IN_ENGINE = [/^@\/shared\/db/, /^@supabase\//, /^next\//, /^server-only$/];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = path.join(dir, n); if (statSync(p).isDirectory()) { if (n !== "node_modules") walk(p, out); } else if (/\.(ts|tsx)$/.test(n)) out.push(p); }
  return out;
}

export function engineViolations(entry: string, aiFiles: Set<string>): string[] {
  const g = closure([entry]);
  const v: string[] = [];
  for (const f of g.files) {
    const r = rel(f);
    if (!/\.(ts|tsx)$/.test(r)) continue;
    if (aiFiles.has(r) || r.startsWith("src/lib/ai/") || /\/fixtures\/boundary\/ai\//.test(r)) v.push(`engine→ai: ${r}`);
    const src = readRel(r);
    for (const s of importSpecifiers(src, true)) if (FORBIDDEN_IN_ENGINE.some((re) => re.test(s))) v.push(`engine→db/runtime: ${r} imports ${s}`);
    for (const c of nondeterministicCalls(src)) v.push(`nondeterminism: ${r} uses ${c}`);
    if (dbWrites(src).length) v.push(`engine writes db: ${r}`);
  }
  for (const [pkg, by] of g.packages) if ((SDK_PACKAGES as readonly string[]).includes(pkg)) v.push(`engine→sdk: ${pkg} (${by.join(", ")})`);
  return v;
}

export function aiLayerViolations(aiFiles: string[], allowed: Set<string>): string[] {
  const set = new Set(aiFiles);
  const v: string[] = [];
  for (const f of aiFiles) {
    for (const w of dbWrites(readRel(f))) if (!allowed.has(w.table)) v.push(`ai writes ${w.table} (${w.op}): ${f}`);
    // كل ما تستورده الطبقة خارجها: لا كاتب قاعدة بيانات (تعديًا)
    const g = closure([f], { stopAt: (r) => set.has(r) && r !== f });
    for (const d of g.files) {
      const r = rel(d);
      if (set.has(r) || !/\.(ts|tsx)$/.test(r)) continue;
      const w = dbWrites(readRel(r));
      if (w.length) v.push(`ai imports writer: ${f} → ${r} (${[...new Set(w.map((x) => x.table))].join(",")})`);
    }
  }
  return v;
}

describe("RULES-1/RULES-5: المحرك نقي", () => {
  it("المحرك لا يصل إلى طبقة الذكاء الاصطناعي ولا حزمة النموذج ولا قاعدة البيانات، ولا يستدعي الوقت أو العشوائية", () => {
    expect(engineViolations(ENGINE_ENTRY, AI)).toEqual([]);
  });
  it("قائمة ملفات المحرك التي يطبق عليها ESLint قاعدة الحتمية تطابق الرسم الفعلي (لا ملف محرك خارج القاعدة)", () => {
    const actual = [...closure([ENGINE_ENTRY]).files].map(rel).filter((r) => /\.(ts|tsx)$/.test(r)).sort();
    expect(engineManifest.files).toEqual(actual);
  });
  it("المدقق يفشل فعلًا على محرك مخالف (ملف fixture يستورد طبقة الذكاء ويستدعي Date.now)", () => {
    const v = engineViolations("tests/fixtures/boundary/engine/bad-engine.ts", AI);
    expect(v.some((x) => x.startsWith("engine→ai"))).toBe(true);
    expect(v.some((x) => x.startsWith("nondeterminism"))).toBe(true);
    expect(v.some((x) => x.startsWith("engine→sdk"))).toBe(true);
  });
});

describe("RULES-2: طبقة الذكاء الاصطناعي", () => {
  it("حزمة النموذج تُستورد في ملف واحد فقط", () => {
    const offenders = walk(path.join(ROOT, "src")).map(rel).filter((r) => r !== SDK_ALLOWED_FILE && importSpecifiers(readRel(r)).some((s) => (SDK_PACKAGES as readonly string[]).includes(s)));
    expect(offenders).toEqual([]);
  });
  it("كل ملفات الطبقة موجودة، ولا تكتب إلا في الجداول المسموحة، ولا تستورد كاتبًا", () => {
    for (const f of AI_LAYER_FILES) expect(() => readRel(f), f).not.toThrow();
    expect(aiLayerViolations([...AI_LAYER_FILES], ALLOWED_TABLES)).toEqual([]);
  });
  it("المدقق يفشل فعلًا على ملف ذكاء اصطناعي يكتب XP ويستورد كاتب أدلة", () => {
    const v = aiLayerViolations(["tests/fixtures/boundary/ai/bad-ai.ts"], ALLOWED_TABLES);
    expect(v.some((x) => x.includes("ai writes xp_events"))).toBe(true);
    expect(v.some((x) => x.includes("ai imports writer"))).toBe(true);
  });
  it("القائمة المسموحة لا تتقاطع مع الممنوعة", () => {
    for (const t of ALLOWED_TABLES) expect(boundary.forbidden_write_targets).not.toContain(t);
  });
});

/** كل ملفات المصدر غير الاختبارية. */
const sourceFiles = () => walk(path.join(ROOT, "src")).map(rel).filter((r) => !/\.test\.(ts|tsx)$/.test(r));

/**
 * الاتجاه المعاكس: من يستورد الطبقة (أو واجهتها أو حزمة النموذج، استيراد وقت التشغيل) أو يستدعي runFunction من خارجها؟
 * يعيد المخالفين غير المسجلين كمنسّقين، والمسجلين الذين لم يعودوا يستوردونها.
 */
export function reverseViolations(files: string[], layer: Set<string>, barrels: Set<string>, orchestrators: Set<string>): { unlisted: string[]; stale: string[]; callsRunFunction: string[] } {
  const importers = new Set<string>(), callsRunFunction: string[] = [];
  for (const r of files) {
    if (layer.has(r) || barrels.has(r)) continue;
    const src = readRel(r), abs = path.resolve(ROOT, r);
    const specs = importSpecifiers(src, true);
    const hitsLayer = specs.map((s) => resolveSpecifier(s, abs)).filter((x): x is string => Boolean(x)).map(rel).some((x) => layer.has(x) || barrels.has(x));
    const hitsSdk = specs.some((s) => (SDK_PACKAGES as readonly string[]).includes(s));
    if (hitsLayer || hitsSdk) importers.add(r);
    if (/\brunFunction\s*\(/.test(stripComments(src))) callsRunFunction.push(r);
  }
  return { unlisted: [...importers].filter((r) => !orchestrators.has(r)).sort(), stale: [...orchestrators].filter((r) => !importers.has(r)).sort(), callsRunFunction };
}

/** ملفات في مواضع/أسماء الطبقة غير مسجلة في AI_LAYER_FILES. */
export function unlistedLayerFiles(files: string[], layer: Set<string>, patterns: readonly RegExp[]): string[] {
  return files.filter((r) => patterns.some((re) => re.test(r)) && !layer.has(r)).sort();
}

describe("الاتجاه المعاكس: من يحق له استيراد طبقة الذكاء الاصطناعي", () => {
  const LAYER = new Set<string>(AI_LAYER_FILES), BARRELS = new Set<string>(AI_BARRELS), ORCH = new Set<string>(AI_ORCHESTRATORS);
  it("لا ملف خارج قائمة المنسّقين يستورد الطبقة أو حزمة النموذج، ولا مدخل زائد في القائمة، وrunFunction لا تُستدعى خارج الطبقة", () => {
    expect(reverseViolations(sourceFiles(), LAYER, BARRELS, ORCH)).toEqual({ unlisted: [], stale: [], callsRunFunction: [] });
  });
  it("كل ملف في مواضع الطبقة مسجل في AI_LAYER_FILES (ملف جديد لا يُتجاهل)", () => {
    expect(unlistedLayerFiles(sourceFiles(), LAYER, AI_LAYER_PATTERNS)).toEqual([]);
  });
  it("المدقق يفشل فعلًا: مستورد غير مسجل، ومستدعٍ لـrunFunction، وملف طبقة جديد غير مسجل (fixtures)", () => {
    const fx = ["tests/fixtures/boundary/outside/bad-importer.ts", "tests/fixtures/boundary/ai/new-ai.ts"];
    const v = reverseViolations(fx, LAYER, BARRELS, ORCH);
    expect(v.unlisted).toEqual(["tests/fixtures/boundary/ai/new-ai.ts", "tests/fixtures/boundary/outside/bad-importer.ts"]);
    expect(v.callsRunFunction).toContain("tests/fixtures/boundary/outside/bad-importer.ts");
    expect(unlistedLayerFiles(fx, LAYER, AI_LAYER_PATTERNS)).toEqual(["tests/fixtures/boundary/ai/new-ai.ts"]);
  });
});
