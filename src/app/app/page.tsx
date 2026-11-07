import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { effective } from "@/modules/settings";
import { loadStartData } from "@/modules/moments/start-data";
import { StartScreen } from "@/modules/moments/components/start-screen";
import HomePage from "./home/page";

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
  void effective;
  return <StartScreen data={data} tz={profile.timezone} />;
}
