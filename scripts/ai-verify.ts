/**
 * ADAPT-8: تبديل النموذج لا يتم إلا بعد نجاح كل الاختبارات الثابتة على النموذج الجديد.
 * يشغّل كل وظيفة (7.2) على النموذج الفعلي (ANTHROPIC_API_KEY + AI_MODEL_ID/_LIGHT) بمدخلات ثابتة، ويتحقق بقواعد الخادم نفسها
 * (Zod + verify)، ويفشل (exit 1) إن سقطت أي وظيفة إلى الثابت. لا يكتب في قاعدة بيانات حقيقية (FakeDb).
 *   pnpm ai:verify
 */
import "dotenv/config";
import { FakeDb } from "../tests/stubs/fake-supabase";
import { anthropicCaller, aiEnabled } from "../src/modules/companion/model";
import { goalBuilderTurn } from "../src/modules/companion/functions/goal-builder";
import { reflectionCoachTurn } from "../src/modules/companion/functions/reflection-coach";
import { selectWithAi } from "../src/modules/companion/functions/mission-selector";
import { classifyTask } from "../src/modules/companion/functions/task-classifier";
import { narrate, weeklySummary, normalizeStrategy } from "../src/modules/companion/functions/narrator-summary-normalizer";
import { adviseAdaptation, draftTemplate } from "../src/modules/companion/functions/adaptation-advisor-drafter";
import { selectSuggestions } from "../src/modules/engine/select";
import { loadTemplatesFromContent } from "../src/modules/library/content";

async function main() {
  if (!aiEnabled()) { console.error("ANTHROPIC_API_KEY غير مضبوط أو AI_DISABLED=1"); process.exit(2); }
  const caller = anthropicCaller();
  const db = new FakeDb().client();
  const templates = loadTemplatesFromContent();
  const results: Array<[string, boolean, string]> = [];
  const check = async (name: string, fn: () => Promise<boolean>) => { try { results.push([name, await fn(), ""]); } catch (e) { results.push([name, false, String((e as Error).message)]); } };
  await check("goal_builder", async () => (await goalBuilderTurn({ db, caller, profileId: "verify", mode: "teen", history: [], userMessage: "أريد أن أنهي واجباتي قبل العشاء", draft: null, turn: 1 })).source === "ai");
  const t = templates.find((x) => x.id === "rd-sim-01")!;
  await check("reflection_coach", async () => (await reflectionCoachTurn({ db, caller, profileId: "verify", mode: "teen", support: "L1_hint", template: t, missionFacts: { gate1: true, hints_used: 0 }, history: [], userMessage: "(بداية التأمل)", turn: 0, customStrategy: null, fixedPrompts: ["ما الذي ساعدك؟"] })).source === "ai");
  await check("mission_selector", async () => {
    const cands = selectSuggestions({ ageMode: "teen", today: "2026-11-05", templates, history: [], states: [], focusCapabilities: [], dailyCount: 3, breakMode: false });
    return (await selectWithAi({ db, caller, profileId: "verify", mode: "teen", candidates: cands, sources: [], goalTitle: "أنهي واجباتي" })).source === "ai";
  });
  await check("task_classifier", async () => (await classifyTask({ db, caller, profileId: "verify", mode: "teen", text: "أرتب غرفتي قبل النوم", goals: [] })) !== null);
  await check("progress_narrator", async () => (await narrate({ db, caller, profileId: "verify", mode: "teen", facts: { gate1: true, gate2: "shown" }, fixedLines: ["أنهيت المهمة."] })).source === "ai");
  await check("weekly_summary", async () => (await weeklySummary({ db, caller, profileId: "verify", mode: "teen", stats: { missions: 5, shown: 2 } })).source === "ai");
  await check("strategy_normalizer", async () => (await normalizeStrategy({ db, caller, profileId: "verify", mode: "teen", mechanic: "decompose", strategy: "أقسم الواجب إلى ثلاث قطع صغيرة" })) !== "custom");
  await check("adaptation_advisor", async () => (await adviseAdaptation({ db, caller, profileId: "verify", mode: "teen", stats: { missions_total: 10, abandoned: 6, missions_by_start_hour_utc: { "20": { n: 6, shown: 0, abandoned: 5 } } }, currentSettings: { daily_mission_count: 3 } })).source === "ai");
  await check("template_drafter", async () => (await draftTemplate({ db, caller, template: t, metrics: { missions_n: 40, shown_rate: 0.1, abandon_rate: 0.6 } })) !== null);
  for (const [n, ok, err] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${err ? `  (${err})` : ""}`);
  const failed = results.filter((r) => !r[1]).length;
  console.log(failed === 0 ? "كل الوظائف نجحت على النموذج الحالي؛ يمكن اعتماده." : `${failed} وظيفة فشلت؛ لا تبدّل النموذج (ADAPT-8).`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
