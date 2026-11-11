import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { effective } from "@/modules/settings";
import { loadStartData } from "@/modules/moments/start-data";
import { StartScreen } from "@/modules/moments/components/start-screen";
import HomePage from "./home/page";
import Link from "next/link";
import { loadLife } from "@/modules/lifelog/service";
import { intakeDue, refreshDue } from "@/modules/lifelog/rules";
import { RefreshPrompt } from "@/modules/lifelog/components/life-log-editor";
import { Alert } from "@/shared/ui";
import lifeContent from "@content/life_log.ar.json";

/** ج.2 شاشة البداية حسب الإعداد start_screen؛ الأمان أو المتابعة المعلّقة تُعرض شاشة المرافق أولًا. */
export default async function AppEntryPage() {
  const s = (await getSession())!;
  const profile = s.profile!;
  const db = await createClient();
  const data = await loadStartData(db, profile);
  const startScreen = data.facts.settings.startScreen;
  const forceCompanion = data.facts.decision.kind === "safety" || data.followups.items.length > 0 || data.returnFlow !== null;
  if (!forceCompanion) {
    if (startScreen === "planner_today") redirect("/app/planner?view=today");
    if (startScreen === "map") redirect("/app/map");
    if (startScreen === "missions_home") return <HomePage />;
  }
  // 0.5 أ.3/أ.6: التعارف أولًا (أو إعادة السؤال بلطف بعد التخطي)، والتجديد كل life_refresh_days — بطاقة خفيفة لا إلزام
  const life = await loadLife(db, profile.id);
  const now = new Date();
  const every = (await effective<number>(db, profile.id, "life_refresh_days")).value;
  const lifeCard = intakeDue({ intakeStatus: life.intake_status, skippedAt: life.intake_skipped_at, now })
    ? <Alert variant="info" className="text-sm"><Link className="underline" href="/onboarding/life">{lifeContent.intake.title}</Link></Alert>
    : refreshDue({ intakeStatus: life.intake_status, intakeCompletedAt: life.intake_completed_at, lastRefreshAt: life.last_refresh_at, everyDays: every, now }) ? <RefreshPrompt profileId={profile.id} /> : null;
  return <div className="space-y-3">{lifeCard}<StartScreen data={data} tz={profile.timezone} /></div>;
}
