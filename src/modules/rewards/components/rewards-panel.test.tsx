import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), redirect: () => {} }));
import { renderToString } from "react-dom/server";
import { GuardianRewardsPanel, PledgesPanel, pledgeText, type RewardRow } from "./rewards-panel";
import rewardsContent from "@content/rewards.ar.json";
import { customization } from "@/shared/config";

const base: RewardRow = { id: "r1", title: "رحلة للحديقة", description: null, icon: "🎁", trigger_type: "gate2_shown_count", trigger_params: { capability_id: "attention", count: 3 }, status: "active", created_by: "u-g", earned_at: null };
const ach = [{ code: "first_step", name: "أول خطوة" }];
const goals = [{ id: "g1", title: "أقرأ أكثر" }];

describe("G05/G06 المكافآت الواقعية", () => {
  it("يعرض تلميح الإنشاء ولا يعرض إرشاد المرحلة قبل المرحلة المحددة", () => {
    const html = renderToString(<GuardianRewardsPanel profileId="p" rewards={[]} achievements={ach} goals={goals} stage={1} creatorName="أبي" />);
    expect(html).toContain(rewardsContent.creation_hint);
    expect(html).not.toContain(rewardsContent.stage_guidance);
    expect(html).toContain('name="trigger_type"');
  });
  it("يعرض إرشاد المرحلة من المرحلة المحددة في config (REWARD-6)", () => {
    const html = renderToString(<GuardianRewardsPanel profileId="p" rewards={[]} achievements={ach} goals={goals} stage={customization.real_rewards.stage_guidance_from_stage} creatorName="أبي" />);
    expect(html).toContain(rewardsContent.stage_guidance);
  });
  it("قائمة المحفزات تأتي من config ولا تحوي محفزات ممنوعة", () => {
    const html = renderToString(<GuardianRewardsPanel profileId="p" rewards={[]} achievements={ach} goals={goals} stage={1} creatorName="أبي" />);
    for (const k of Object.keys(customization.real_rewards.allowed_triggers)) expect(html).toContain(`value="${k}"`);
    expect(html).not.toContain('value="xp_total"');
    expect(html).not.toContain('value="streak"');
  });
  it("أزرار الانتقال حسب الحالة: earned → سلّمتها", () => {
    const html = renderToString(<GuardianRewardsPanel profileId="p" rewards={[{ ...base, status: "earned" }]} achievements={ach} goals={goals} stage={1} creatorName="أبي" />);
    expect(html).toContain('value="delivered"');
    expect(html).not.toContain('value="active"');
  });
});

describe("P15 عهودي", () => {
  it("نص العهد يذكر المنشئ والقدرة والعدد (5.7)", () => {
    const text = pledgeText(base, "أبي", ach, goals);
    expect(text).toContain("أبي");
    expect(text).toContain("رحلة للحديقة");
    expect(text).toContain("3");
  });
  it("لا يعرض المسودات، ويعرض زر الاستلام للمُسلَّمة فقط", () => {
    const html = renderToString(<PledgesPanel rewards={[{ ...base, id: "d", status: "draft" }, { ...base, status: "delivered" }]} achievements={ach} goals={goals} creatorNames={{ "u-g": "أبي" }} />);
    expect(html).toContain('value="acknowledged"');
    expect((html.match(/رحلة للحديقة/g) ?? []).length).toBeGreaterThan(0);
    expect(html).not.toContain(rewardsContent.status.draft);
  });
  it("بلا عهود: رسالة فارغة", () => {
    const html = renderToString(<PledgesPanel rewards={[]} achievements={ach} goals={goals} creatorNames={{}} />);
    expect(html).toContain(rewardsContent.no_pledges);
  });
});
