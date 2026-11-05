import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { OnboardingForm } from "./onboarding-form";
import { NewChildForm } from "./new-child-form";
import dataPolicy from "@content/data_policy.ar.json";
import explainers from "@content/explainers.ar.json";

describe("نماذج المرحلة 0", () => {
  it("P01: اختيار الوضع يعرض teen/adult/مربٍ ولا يعرض child كخيار ذاتي", () => {
    const html = renderToString(<OnboardingForm explainers={{ what: explainers.what_is_app, ai: explainers.ai_disclosure, who: explainers.who_sees_what, guardrails: explainers.guardrails_intro, noDiagnosis: explainers.no_diagnosis }} />);
    expect(html).toContain("مراهق");
    expect(html).toContain("بالغ");
    expect(html).toContain("أنا مربٍ");
    expect(html).toContain("يُنشأ من لوحة المربي");
  });
  it("G01: إنشاء الطفل يتطلب الموافقة على سياسة البيانات بإصدارها", () => {
    const html = renderToString(<NewChildForm policy={dataPolicy} childExplainers={{ what: explainers.what_is_app.child, ai: explainers.ai_disclosure.child, who: explainers.who_sees_what.child }} />);
    expect(html).toContain(dataPolicy.policy_version);
    expect(html).toContain('name="consent"');
    expect(html).toContain("required");
    expect(html).toContain(explainers.ai_disclosure.child);
  });
});
