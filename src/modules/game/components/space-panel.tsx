import type { GameView } from "../service";
import { SpaceIllustration } from "./space-illustration";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import spaceContent from "@content/space.ar.json";
import surprisesContent from "@content/surprises.ar.json";

export function XpBar({ view }: { view: GameView }) {
  if (!view.visible.has("xp_number_and_level_bar")) return null;
  const prev = 50 * view.level * (view.level + 1);
  const pct = Math.min(100, Math.round(((view.xp - prev) / (view.nextLevelXp - prev)) * 100));
  return (
    <div className="space-y-1" aria-label={spaceContent.xp_label}>
      <div className="flex justify-between text-sm"><span>{spaceContent.level_label} {view.level}</span><span dir="ltr" className="tabular-nums">{view.xp} / {view.nextLevelXp} XP</span></div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** P16: مساحتي + الإنجازات. كل عنصر لعبي يخضع للكثافة (جدول أ.7)؛ قائمة الإنجازات النصية ليست عنصرًا لعبيًا. */
export function SpacePanel({ view, compact = false }: { view: GameView; compact?: boolean }) {
  const space = view.visible.has("avatar_and_space");
  const badges = view.visible.has("achievement_badges");
  const collectibles = view.visible.has("collectibles_and_unlocks");
  return (
    <div className="space-y-3">
      {space && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{spaceContent.space_title} · {view.themeName}</CardTitle><CardDescription>{view.stageName} — {spaceContent.grows_with}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <SpaceIllustration theme={view.theme} stage={view.avatarStage} label={`${view.themeName}: ${view.stageName}`} />
            <XpBar view={view} />
          </CardContent>
        </Card>
      )}
      {!space && !compact && <XpBar view={view} />}
      {!compact && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{spaceContent.achievements_title}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {view.achievements.length === 0 && <p className="text-sm text-muted-foreground">{spaceContent.no_achievements}</p>}
            {view.achievements.map((a, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border p-2 text-sm">
                {badges && <span aria-hidden className="text-2xl leading-none">{a.icon}</span>}
                <div><div className="font-medium">{a.name}{a.tier > 1 ? ` (${a.tier})` : ""}</div><div className="text-muted-foreground">{a.description}</div></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {space && !compact && view.surprises.some((x) => x.kind === "cosmetic") && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{surprisesContent.space_title}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">{view.surprises.filter((x) => x.kind === "cosmetic").map((x, i) => <Badge key={i} variant="secondary" className="text-base">{x.payload.icon}</Badge>)}</CardContent>
        </Card>
      )}
      {collectibles && !compact && view.collectibles.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{spaceContent.collectibles_title}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">{view.collectibles.map((c, i) => <Badge key={i} variant="secondary" className="text-base">{c.icon}</Badge>)}</CardContent>
        </Card>
      )}
    </div>
  );
}
