import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), redirect: () => {} }));
import { renderToString } from "react-dom/server";
import { ContextEditor, OnboardingContext } from "./context-editor";
import { emptyContext } from "../personal-context";
import content from "@content/personal_context.ar.json";

describe("P03/G12 سياق الحياة (ADAPT-1/2)", () => {
  it("يعرض الحقول الأربعة والتنبيه بالممنوعات", () => {
    const html = renderToString(<ContextEditor profileId="p" context={{ ...emptyContext(), interests: ["كرة القدم"] }} suggestions={[]} />);
    for (const f of Object.values(content.fields)) expect(html).toContain(f);
    expect(html).toContain(content.forbidden_notice);
    expect(html).toContain("كرة القدم");
    expect(html).toContain('name="value"');
  });
  it("الاقتراحات لا تُحفظ إلا بموافقة: زرا قبول/رفض", () => {
    const html = renderToString(<ContextEditor profileId="p" context={emptyContext()} suggestions={[{ id: "s1", field: "contexts", value: "المسجد" }]} />);
    expect(html).toContain("المسجد");
    expect(html).toContain('value="accepted"');
    expect(html).toContain('value="rejected"');
  });
  it("للقراءة فقط: لا نماذج إضافة ولا اقتراحات", () => {
    const html = renderToString(<ContextEditor profileId="p" context={emptyContext()} suggestions={[{ id: "s1", field: "contexts", value: "المسجد" }]} readOnly />);
    expect(html).not.toContain('name="value"');
    expect(html).not.toContain("المسجد");
  });
  it("الانضمام: سؤالان اختياريان", () => {
    const html = renderToString(<OnboardingContext profileId="p" />);
    expect(html).toContain(content.onboarding.interest);
    expect(html).toContain(content.onboarding.free_window);
  });
});
