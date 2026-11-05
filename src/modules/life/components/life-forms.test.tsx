import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), redirect: () => {} }));
import { renderToString } from "react-dom/server";
import { RealMissionForm, TransferForm, ObservationForm, ApprovalsList, MoreSupportForm } from "./life-forms";
import realMissions from "@content/real_missions.ar.json";
import observations from "@content/guardian_observations.ar.json";

describe("G04 / MIS-2 مهمة واقعية", () => {
  it("المربي يرى خيار التكرار، والمتدرب لا يراه", () => {
    const g = renderToString(<RealMissionForm profileId="p" isSelf={false} aiEnabled={false} />);
    const s = renderToString(<RealMissionForm profileId="p" isSelf aiEnabled={false} />);
    expect(g).toContain('name="recurring"');
    expect(s).not.toContain('name="recurring"');
    expect(s).toContain(realMissions.self_add_title);
  });
  it("بلا AI: اختيار الميكانيكية يدويًا إلزامي", () => {
    const html = renderToString(<RealMissionForm profileId="p" isSelf={false} aiEnabled={false} />);
    expect(html).toContain('name="mechanic"');
    expect(html).toContain(realMissions.mechanic_manual);
  });
});

describe("P11 تقرير النقل (LIFE-2)", () => {
  it("ثلاثة أسئلة: أين، ماذا، هل نجح", () => {
    const html = renderToString(<TransferForm missionId="m1" capabilityId="attention" />);
    expect(html).toContain(realMissions.transfer.where);
    expect(html).toContain(realMissions.transfer.what);
    expect(html).toContain(realMissions.transfer.worked);
    expect(html).toContain('name="context_tag"');
    expect(html).not.toContain('value="in_app"');
  });
});

describe("G02 إضافات المربي", () => {
  it("ملاحظة بصيغة محددة من content (GUARD-3)", () => {
    const html = renderToString(<ObservationForm profileId="p" />);
    for (const k of Object.keys(observations.types)) expect(html).toContain(`value="${k}"`);
    expect(html).not.toContain('name="free_text"');
  });
  it("قائمة الموافقات تظهر فقط عند وجود مهام", () => {
    expect(renderToString(<ApprovalsList missions={[]} />)).toBe("");
    expect(renderToString(<ApprovalsList missions={[{ id: "m", title: "ترتيب الغرفة" }]} />)).toContain(realMissions.approve);
  });
  it("زر دعم أكثر (GUARD-9)", () => {
    expect(renderToString(<MoreSupportForm profileId="p" />)).toContain(realMissions.more_support.button);
  });
});
