import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), redirect: () => {} }));
import { renderToString } from "react-dom/server";
import { Inbox } from "./inbox";
import { PushToggle } from "./push-toggle";
import content from "@content/notifications.ar.json";

describe("صندوق الإشعارات وتفعيل الدفع", () => {
  it("فارغ → رسالة؛ غير مقروء ومُرسل → زر علّم كمقروء؛ مجدول بلا زر", () => {
    expect(renderToString(<Inbox items={[]} />)).toContain(content.inbox.empty);
    const html = renderToString(<Inbox items={[
      { id: "1", type: "mission_today", title: "مهمة اليوم", body: "ب", url: "/app", scheduled_for: "2026-11-05T14:00:00Z", sent_at: "2026-11-05T14:00:00Z", read_at: null },
      { id: "2", type: "comeback", title: null, body: null, url: null, scheduled_for: "2026-11-06T14:00:00Z", sent_at: null, read_at: null },
    ]} />);
    expect(html).toContain("مهمة اليوم");
    expect((html.match(new RegExp(content.inbox.mark_read, "g")) ?? []).length).toBe(1);
    expect(html).toContain(content.inbox.scheduled);
  });
  it("PushToggle يصيّر العنوان ونص المربي", () => {
    const html = renderToString(<PushToggle audience="guardian" />);
    expect(html).toContain(content.push.title);
    expect(html).toContain(content.push.guardian_intro);
  });
});
