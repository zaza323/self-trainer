/** ب.15: عند L2 لوحة «قسّمها» تسأل «شو أول خطوة؟» ولا تعرض أي خطوة أو زر اقتراح قبل خطوة المستخدم. */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { BreakdownPanel, DayPlanPanel } from "./phase11-panels";
import content from "@content/planner.ar.json";

describe("واجهة ذكاء المخطط بالتدرج", () => {
  it("L2–L3: السؤال أولًا بلا زر اقتراح", () => {
    const html = renderToString(<BreakdownPanel taskId="00000000-0000-4000-8000-000000000001" lowSupport={false} />);
    expect(html).toContain(content.ai.breakdown.ask_first);
    expect(html).not.toContain(content.ai.breakdown.suggest);
    expect(html).not.toContain(content.ai.breakdown.propose);
  });
  it("L0–L1: زر «اقترح مسودة» متاح", () => {
    const html = renderToString(<BreakdownPanel taskId="00000000-0000-4000-8000-000000000001" lowSupport />);
    expect(html).toContain(content.ai.breakdown.propose); expect(html).not.toContain('data-testid="ask-first"');
  });
  it("رتّب يومي: L2+ يطلب اختيار 1–3 أولًا", () => {
    const html = renderToString(<DayPlanPanel tasks={[{ id: "a", title: "تقرير" }]} pickMode />);
    expect(html).toContain(content.ai.day_planner.pick_title); expect(html).toContain(content.ai.day_planner.place);
  });
});
