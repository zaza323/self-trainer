import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { effective } from "@/modules/settings";
import { loadActiveTemplates, textByMode } from "@/modules/library";
import { challengesVisible, type ChallengeRow, type ParticipantRow } from "@/modules/challenges";
import { ChallengesPanel, type ChallengeListItem } from "@/modules/challenges/components/challenges-ui";
import { Alert } from "@/shared/ui";
import { game, type AgeMode } from "@/shared/config";
import content from "@content/challenges.ar.json";

/** P21 التحديات (تعديل 0.3 §2): تظهر عند كثافة ≥ min_intensity والإعداد مفعّل. */
export default async function ChallengesPage() {
  const s = (await getSession())!;
  const p = s.profile!;
  const mode = p.age_mode as AgeMode;
  const db = await createClient();
  if (!(await challengesVisible(db, { id: p.id, game_intensity: p.game_intensity }))) return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.title}</h2><Alert>{content.hidden_reason}</Alert></div>;
  const [{ data: parts }, templates, autoMatchOn] = await Promise.all([
    db.from("challenge_participants").select("*").eq("profile_id", p.id),
    loadActiveTemplates(db),
    effective<boolean>(db, p.id, "challenge_auto_match"),
  ]);
  const mine = (parts ?? []) as ParticipantRow[];
  const ids = mine.map((x) => x.challenge_id);
  const { data: chs } = ids.length ? await db.from("challenges").select("*").in("id", ids).order("created_at", { ascending: false }) : { data: [] };
  const { data: allParts } = ids.length ? await db.from("challenge_participants").select("challenge_id, left_at, requires_approval, approved_by_guardian_id").in("challenge_id", ids) : { data: [] };
  const byT = new Map(templates.map((t) => [t.id, t]));
  const items: ChallengeListItem[] = ((chs ?? []) as ChallengeRow[]).map((c) => {
    const me = mine.find((x) => x.challenge_id === c.id)!;
    const members = ((allParts ?? []) as Array<{ challenge_id: string; left_at: string | null; requires_approval: boolean; approved_by_guardian_id: string | null }>).filter((x) => x.challenge_id === c.id && !x.left_at && (!x.requires_approval || x.approved_by_guardian_id)).length;
    return { ...c, title: textByMode(byT.get(c.template_id)?.title, mode) || c.template_id, members, mine: me.left_at ? "left" : me.requires_approval && !me.approved_by_guardian_id ? "pending" : "member" };
  });
  const tplOptions = templates.filter((t) => t.age_modes.includes(mode)).map((t) => ({ id: t.id, version: t.version, title: textByMode(t.title, mode) }));
  const canCreate = mode !== "child";
  const canAutoMatch = game.challenges.auto_match_age_modes.includes(mode) && Boolean(autoMatchOn.value);
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{content.title}</h2><ChallengesPanel items={items} templates={tplOptions} canCreate={canCreate} canAutoMatch={canAutoMatch} /></div>;
}
