import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { SuggestionsPanel, type SuggestionRow } from "@/modules/adaptation/components/suggestions-panel";
import content from "@content/adaptation.ar.json";

/** P18 اقتراحات التكيّف (ADAPT-4): في teen وadult يقرر المتدرب؛ في child يقرر المربي (تُعرض للقراءة). */
export default async function SuggestionsPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const { data } = await db.from("adaptation_suggestions").select("*").eq("profile_id", s.profile!.id).eq("audience", "owner").order("created_at", { ascending: false }).limit(30);
  const child = s.profile!.age_mode === "child";
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.suggestions.title}</h2><SuggestionsPanel items={(data ?? []) as SuggestionRow[]} canDecide={!child} childNote={child} /></div>;
}
