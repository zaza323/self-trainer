/**
 * قواعد الانتقال بين الأوضاع العمرية (القسم 13، ACC-11) كدالة نقية.
 * التنفيذ الفعلي ذرّي داخل app.transition_age_mode في قاعدة البيانات؛ هذه الدالة
 * تعطي الخطة نفسها للواجهة والاختبارات، وتُبقي القاعدتين متطابقتين.
 */
import { customization, type AgeMode } from "@/shared/config";
import { VIEW_PROGRESS_ONLY, type PermissionSet } from "@/shared/config/permissions";

export type LinkSnapshot = { id: string; permissions: PermissionSet; status: "invited" | "active" | "removed" };
export type LockSnapshot = { key: string; locked: boolean };

export type TransitionPlan = {
  from: AgeMode;
  to: AgeMode;
  /** الروابط التي تتغير صلاحياتها (teen → adult) */
  linkPermissionResets: Array<{ id: string; permissions: PermissionSet }>;
  /** المفاتيح التي يُرفع قفلها (child → teen، عدا إعدادات الأمان) */
  unlockKeys: string[];
  /** مفاتيح تبقى مقفلة (إعدادات الأمان) */
  keptLockedKeys: string[];
  /** من يستطيع تنفيذ الانتقال */
  allowedActor: "creator_guardian" | "player";
};

export function planAgeTransition(args: {
  from: AgeMode;
  to: AgeMode;
  links: LinkSnapshot[];
  locks: LockSnapshot[];
}): TransitionPlan {
  const { from, to, links, locks } = args;
  if (from === to) throw new Error("same_mode");
  if (to === "child") throw new Error("cannot_transition_into_child");

  const safetyKeys = new Set(customization.edit_rules.teen.lockable_keys_override ?? []);
  const plan: TransitionPlan = {
    from, to,
    linkPermissionResets: [],
    unlockKeys: [],
    keptLockedKeys: [],
    allowedActor: from === "child" ? "creator_guardian" : "player",
  };

  if (from === "child" && to === "teen") {
    for (const l of locks) {
      if (!l.locked) continue;
      if (safetyKeys.has(l.key)) plan.keptLockedKeys.push(l.key);
      else plan.unlockKeys.push(l.key);
    }
  }
  if (to === "adult") {
    for (const l of links) {
      if (l.status !== "active") continue;
      plan.linkPermissionResets.push({ id: l.id, permissions: { ...VIEW_PROGRESS_ONLY } });
    }
    // child → adult مباشرة: تُرفع كل الأقفال أيضًا (لا قفل في adult)
    for (const l of locks) if (l.locked) plan.unlockKeys.push(l.key);
  }
  return plan;
}
