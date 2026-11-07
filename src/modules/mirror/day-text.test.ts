import { describe, it, expect } from "vitest";
import { parseDayText, inventedTimes, mentionedTimes } from "./day-text";

const ALL = ["sleep", "study", "work", "prayer_worship", "meals", "commute", "family_friends", "exercise", "restorative_rest", "phone_screens", "home_chores", "unknown"];

describe("ط.12-3/4 المحلّل الحتمي لإعادة بناء اليوم", () => {
  it("«صحيت 9 وقعدت عالجوال لـ 11» ⇒ مقطعان بأوقاتهما", () => {
    const r = parseDayText("صحيت 9 وقعدت عالجوال لـ 11", ALL);
    expect(r.blocks.map((b) => [b.category, b.start, b.end])).toEqual([["sleep", "00:00", "09:00"], ["phone_screens", "09:00", "11:00"]]);
    expect(inventedTimes(r.blocks, "صحيت 9 وقعدت عالجوال لـ 11")).toEqual([]);
  });
  it("نشاط بلا وقت لا يصير مقطعًا (يبقى بلا مكان)، والساعة بعد الظهر تُفهم مساءً تصاعديًا", () => {
    const r = parseDayText("صحيت 8، فطرت، بعدين رحت عالجامعة من 10 لـ 2، وتغديت", ALL);
    expect(r.blocks.map((b) => [b.category, b.start, b.end])).toEqual([["sleep", "00:00", "08:00"], ["study", "10:00", "14:00"]]);
    expect(r.unplaced.map((u) => u.category)).toEqual(expect.arrayContaining(["meals"]));
    expect(r.gaps).toEqual([{ start: "08:00", end: "10:00" }]);
  });
  it("نص بلا أي وقت ⇒ لا مقاطع إطلاقًا", () => {
    expect(parseDayText("قعدت عالجوال كتير وبعدين درست", ALL).blocks).toEqual([]);
  });
  it("التحقق يرفض وقتًا لم يُذكر", () => {
    expect(inventedTimes([{ start: "09:00", end: "10:30" }], "صحيت 9")).toEqual(["10:30"]);
    expect(inventedTimes([{ start: "09:00", end: "10:30" }], "صحيت 9", ["10:30"])).toEqual([]);
    expect(mentionedTimes("لـ 11").has("23:00")).toBe(true);
  });
});
