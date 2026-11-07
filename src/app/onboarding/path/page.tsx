import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { onboardingPathAction } from "@/modules/mirror/actions";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/mirror.ar.json";

/** P01b (ط.2): «نبلش من يومك أو من أهدافك؟» قبل P02 للمراهق والبالغ. */
export default async function OnboardingPathPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.profile) redirect("/onboarding");
  if (s.profile.onboarding_path) redirect("/onboarding/context");
  async function act(fd: FormData) { "use server"; await onboardingPathAction(null, fd); }
  return (
    <main className="mx-auto max-w-xl p-4 py-8">
      <Card><CardHeader><CardTitle>{content.onboarding.title}</CardTitle><CardDescription>{content.onboarding.intro}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <form action={act} className="flex flex-wrap gap-2">
            <Button type="submit" name="path" value="reality">{content.onboarding.start_reality}</Button>
            <Button type="submit" name="path" value="goals" variant="outline">{content.onboarding.start_goals}</Button>
          </form>
          <p className="text-xs text-muted-foreground">{content.onboarding.privacy}</p>
        </CardContent></Card>
    </main>
  );
}
