import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { GuardiansPanel } from "./guardians-panel";
import { ALL_PERMISSIONS, VIEW_PROGRESS_ONLY, GUARDIAN_PERMISSIONS } from "@/shared/config/permissions";

const links = [
  { id: "l1", guardian_id: "g1", player_id: "p", relation: "mother" as const, is_creator: true, permissions: ALL_PERMISSIONS, status: "active" as const, invited_by: null, created_at: "", updated_at: "" },
  { id: "l2", guardian_id: "g2", player_id: "p", relation: "teacher" as const, is_creator: false, permissions: VIEW_PROGRESS_ONLY, status: "active" as const, invited_by: "g1", created_at: "", updated_at: "" },
];
const invites = [{ id: "i1", player_id: "p", invited_by: "g1", email: null, code: "abcdef123456", relation: "coach" as const, permissions: VIEW_PROGRESS_ONLY, expires_at: new Date(Date.now() + 86400000).toISOString(), accepted_at: null, accepted_by: null, created_at: "" }];

describe("GuardiansPanel (G08 / ACC-7 / ACC-8)", () => {
  it("يعرض المربين بصفاتهم وصلاحياتهم التسع ونموذج الدعوة لمن يدير", () => {
    const html = renderToString(<GuardiansPanel playerId="p" ageMode="child" currentUserId="g1" canManage links={links} invites={invites} guardianNames={{ g1: "أم", g2: "معلم" }} />);
    expect(html).toContain("أم");
    expect(html).toContain("المنشئ");
    expect(html).toContain("abcdef123456");
    for (const p of GUARDIAN_PERMISSIONS) expect(html).toContain(`perm_${p}`);
    expect(html).toContain("دعوة مربٍ");
  });
  it("بلا manage_guardians: عرض فقط بلا دعوة ولا إزالة", () => {
    const html = renderToString(<GuardiansPanel playerId="p" ageMode="teen" currentUserId="g2" canManage={false} links={links} invites={[]} guardianNames={{}} />);
    expect(html).not.toContain("دعوة مربٍ");
    expect(html).not.toContain(">إزالة<");
  });
});
