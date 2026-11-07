/** ط.12-10: خلال أسبوع المرآة تحل إعادة البناء محل خطوة «أنجزت» في المحاسبة، ولا تضاف لحظة جديدة (عدد الخطوات نفسه). */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { MuhasabaFlow } from "./muhasaba-flow";
import { stepsFor } from "../flow";
import { mirrorConfig } from "@/modules/mirror/reconstruct";
import content from "@content/muhasaba.ar.json";

const view = { entry: { id: "00000000-0000-4000-8000-000000000001", profile_id: "p", local_date: "2026-11-07", achieved: [], shortfalls: [], next_steps: [], rest_day: false, completed: false, session_id: null }, steps: stepsFor("teen", false), suggestedAchieved: [{ text: "مهمة منجزة", source: "planner" }], suggestedShortfalls: [], candidateNext: [], restDay: false };

describe("أسبوع المرآة في المحاسبة", () => {
  it("الخطوة المستبدلة تعرض إعادة البناء بدل قائمة «أنجزت»، والتقدم بنفس عدد الخطوات", () => {
    const step = mirrorConfig.mirror_week.replaces_muhasaba_step;
    expect(view.steps[0]).toBe(step);
    const html = renderToString(<MuhasabaFlow view={view} ageMode="teen" alreadyDone={false} replacedStep={step} />);
    expect(html).toContain('data-testid="muhasaba-mirror-week"');
    expect(html).toContain("/app/mirror/reconstruct?date=today&amp;source=muhasaba");
    expect(html).not.toContain("مهمة منجزة");
    expect(html).toContain(content.progress.replace("{i}", "1").replace("{n}", String(view.steps.length)));
  });
  it("خارج أسبوع المرآة: الخطوة العادية", () => {
    const html = renderToString(<MuhasabaFlow view={view} ageMode="teen" alreadyDone={false} />);
    expect(html).toContain("مهمة منجزة"); expect(html).not.toContain('data-testid="muhasaba-mirror-week"');
  });
});
