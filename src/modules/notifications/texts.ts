import content from "@content/notifications.ar.json";
import type { AgeMode } from "@/shared/config";

/** نصوص الإشعارات من content (NOTIF-2) مع فحص الممنوعات (NOTIF-3). */
export type Audience = AgeMode | "guardian";
type Tpl = { title: string; body: string };
const TYPES = content.types as Record<string, Partial<Record<Audience, Tpl>>>;

export function notificationTypes(): string[] { return Object.keys(TYPES); }

export function renderNotification(type: string, audience: Audience, vars: Record<string, string | number | null | undefined> = {}): Tpl | null {
  const byAud = TYPES[type];
  if (!byAud) return null;
  const tpl = byAud[audience] ?? byAud.guardian ?? byAud.adult ?? byAud.teen ?? byAud.child;
  if (!tpl) return null;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k])));
  return { title: fill(tpl.title), body: fill(tpl.body) };
}

/** NOTIF-3: لا خسارة ولا استعجال ولا مقارنة. */
export function containsForbidden(text: string): string | null {
  for (const p of content.forbidden_patterns) if (text.includes(p)) return p;
  return null;
}

/** الرابط الذي يفتحه الإشعار. */
export function urlForNotification(type: string, payload: Record<string, unknown>, audience: Audience): string {
  const pid = typeof payload.profile_id === "string" ? payload.profile_id : "";
  if (audience === "guardian") {
    if (type === "safety_alert" || type === "human_requested") return pid ? `/guardian/${pid}/chat` : "/guardian";
    if (type === "reward_earned_guardian") return pid ? `/guardian/${pid}/rewards` : "/guardian";
    return "/guardian/notifications";
  }
  switch (type) {
    case "mission_today": case "comeback": case "mastery_check": return "/app";
    case "transfer_invite": case "mission_approved": return typeof payload.mission_id === "string" ? `/app/missions/${payload.mission_id}` : "/app";
    case "reward_earned": case "reward_cancelled": return "/app/pledges";
    case "settings_changed_by_guardian": return "/app/settings";
    case "safety_resources": return "/app/chat";
    case "adaptation_suggestion": return "/app/suggestions";
    case "planner_reminder": return typeof payload.task_id === "string" ? `/app/planner/${payload.task_id}${typeof payload.reminder_id === "string" ? `?reminder=${payload.reminder_id}` : ""}` : "/app/planner";
    default: return "/app/notifications";
  }
}
