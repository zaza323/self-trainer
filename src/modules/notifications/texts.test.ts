import { describe, it, expect } from "vitest";
import { renderNotification, containsForbidden, urlForNotification, notificationTypes } from "./texts";
import { limits } from "@/shared/config";
import content from "@content/notifications.ar.json";

describe("نصوص الإشعارات (NOTIF-2، NOTIF-3)", () => {
  it("كل نص في المحتوى خالٍ من الخسارة والاستعجال والمقارنة", () => {
    for (const [type, byAud] of Object.entries(content.types)) for (const [aud, tpl] of Object.entries(byAud as Record<string, { title: string; body: string }>)) {
      expect(containsForbidden(tpl.title), `${type}/${aud}`).toBeNull();
      expect(containsForbidden(tpl.body), `${type}/${aud}`).toBeNull();
    }
    expect(containsForbidden("انقطعت سلسلتك! أسرع")).not.toBeNull();
  });
  it("كل نوع في config له نص", () => {
    for (const t of [...limits.notifications.types_in_cap, ...limits.notifications.bypass_types]) expect(notificationTypes(), t).toContain(t);
  });
  it("المتغيرات تُملأ، والجمهور يسقط إلى المتاح", () => {
    expect(renderNotification("reward_earned", "child", { title: "رحلة" })!.body).toContain("رحلة");
    expect(renderNotification("safety_alert", "teen", { name: "سارة" })!.body).toContain("سارة"); // لا نسخة teen → guardian
    expect(renderNotification("nope", "adult")).toBeNull();
  });
  it("الروابط حسب النوع والجمهور", () => {
    expect(urlForNotification("transfer_invite", { mission_id: "m1" }, "teen")).toBe("/app/missions/m1");
    expect(urlForNotification("safety_alert", { profile_id: "p1" }, "guardian")).toBe("/guardian/p1/chat");
    expect(urlForNotification("reward_earned", {}, "child")).toBe("/app/pledges");
  });
});
