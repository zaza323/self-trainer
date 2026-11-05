import { describe, it, expect } from "vitest";
import phrases from "@content/phrases.ar.json";
import { CAPABILITY_IDS, AGE_MODES } from "@/shared/config";

describe("content/phrases.ar.json (أ.3: 3 نطاقات × 8 قدرات × 3 أوضاع)", () => {
  it("72 عبارة كاملة وبلا أحكام على الشخصية", () => {
    const P = phrases.phrases as Record<string, Record<string, Record<string, string>>>;
    let n = 0;
    for (const cap of CAPABILITY_IDS) for (const band of ["needs_support", "growing", "strong"]) for (const mode of AGE_MODES) {
      const s = P[cap]?.[band]?.[mode];
      expect(s, `${cap}.${band}.${mode}`).toBeTruthy();
      expect(s).not.toMatch(/كسول|فاشل|غبي|مريض|اضطراب/);
      n++;
    }
    expect(n).toBe(72);
  });
});
