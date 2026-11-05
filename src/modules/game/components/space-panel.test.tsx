/** أ.11 اختبار 6 على الواجهة: كثافة 0 → لا عنصر لعبي يُصيَّر؛ والاحتفال لا يظهر إلا بحسب الكثافة. */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { SpacePanel } from "./space-panel";
import { Celebration } from "./celebration";
import { visibleElements } from "../stage";
import type { GameView } from "../service";

const view = (intensity: number, stage: 1 | 2 | 3 | 4 = 1): GameView => ({
  stage, intensity, visible: visibleElements(intensity, stage), xp: 120, level: 1, nextLevelXp: 300, avatarStage: 3, theme: "garden", themeName: "حديقة", stageName: "شتلة بورقتين",
  achievements: [{ code: "comeback", name: "عدتَ بعد انقطاع", description: "وصف", icon: "↩", tier: 1, earned_at: "", source_id: null }],
  collectibles: [{ icon: "🛡", kind: "resist_distraction", earned_at: "" }], surprises: [],
});

describe("SpacePanel / Celebration حسب الكثافة", () => {
  it("كثافة 0: لا مساحة ولا XP ولا شارات ولا عناصر تجميعية؛ الإنجاز يبقى كنص", () => {
    const html = renderToString(<SpacePanel view={view(0)} />);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("XP");
    expect(html).not.toContain("🛡");
    expect(html).not.toContain("↩");
    expect(html).toContain("عدتَ بعد انقطاع");
  });
  it("كثافة 90 في المرحلة 1: كل شيء يظهر", () => {
    const html = renderToString(<SpacePanel view={view(90)} />);
    expect(html).toContain("<svg");
    expect(html).toContain("XP");
    expect(html).toContain("🛡");
    expect(html).toContain("↩");
    expect(html).toContain("شتلة بورقتين");
  });
  it("كثافة 35: مساحة وXP لكن بلا عناصر تجميعية؛ المرحلة 3 بلا عناصر تجميعية حتى عند 90", () => {
    const html = renderToString(<SpacePanel view={view(35)} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("🛡");
    expect(renderToString(<SpacePanel view={view(90, 3)} />)).not.toContain("🛡");
  });
  it("الاحتفال: none لا يُصيَّر؛ subtle وfull يُصيَّران", () => {
    expect(renderToString(<Celebration level="none" messages={["x"]} />)).toBe("");
    expect(renderToString(<Celebration level="subtle" messages={["ظهرت المهارة."]} />)).toContain("ظهرت المهارة.");
    expect(renderToString(<Celebration level="full" messages={["ظهرت المهارة في هذه المهمة!"]} />)).toContain("ظهرت المهارة في هذه المهمة!");
  });
});
