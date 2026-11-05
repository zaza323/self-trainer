import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), redirect: () => {} }));
import { renderToString } from "react-dom/server";
import { CapabilityMap } from "./capability-map";
import type { MapView } from "../queries";

const item = (over: Partial<MapView["items"][number]>): MapView["items"][number] => ({
  id: "attention", name: "الانتباه", description: "ما يشتته", score: 67, confidence: 0.44, confidenceBand: "tentative", scoreBand: "strong", phrase: "انتباهك قوي — مبدئي",
  training_level: "simulated", support_level: "L1_hint", focused: false, trajectory: [{ date: "2026-11-01", score: 56, confidence: 0.25 }, { date: "2026-11-05", score: 67, confidence: 0.44 }], decline: null, evidence_count: 5, ...over,
});

describe("P12 خريطة قدراتي (MAP-1..4)", () => {
  it("يعرض الدرجة والعبارة والمستويات والمسار، ويُخفي النسبة عند ثقة منخفضة", () => {
    const view: MapView = { intro: "ليست درجات", insightsDefault: "x", insights: { text: "تعلمت أني أؤجل", edited: false }, items: [item({}), item({ id: "planning", name: "التخطيط", confidenceBand: "unknown", phrase: "لا نعرف بعد", focused: true, training_level: "mastered" })] };
    const html = renderToString(<CapabilityMap view={view} />);
    expect(html).toContain("67%");
    expect(html).toContain("انتباهك قوي — مبدئي");
    expect(html).toContain("<svg");
    expect(html).toContain("لا نعرف بعد");
    expect(html).toContain("مركّز عليها");
    expect(html).toContain("متقنة");
    expect(html).toContain("تعلمت أني أؤجل");
    expect(html).not.toMatch(/XP/);
  });
  it("الانخفاض يُعرض بلغة محايدة مع سؤال واحد، والمربي يرى للقراءة فقط", () => {
    const view: MapView = { intro: "", insightsDefault: "", insights: { text: "", edited: false }, items: [item({ decline: { message: "انخفضت", question: "ما الذي تغيّر؟" } })] };
    const html = renderToString(<CapabilityMap view={view} />);
    expect(html).toContain("ما الذي تغيّر؟");
    expect(html).toContain('name="decline_answer"');
    const ro = renderToString(<CapabilityMap view={view} readOnly />);
    expect(ro).not.toContain("<textarea");
  });
});
