import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { OnboardingContext } from "@/modules/adaptation/components/context-editor";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/personal_context.ar.json";

/** P03 (5.1 خطوة 3): سؤالان اختياريان لسياق الحياة بعد إنشاء الملف. */
export default async function OnboardingContextPage() {
  const s = await getSession();
  if (!s?.profile) redirect("/onboarding");
  if (s.profile.kind !== "player") redirect("/guardian");
  return (
    <main className="mx-auto max-w-xl p-4 py-8">
      <Card><CardHeader><CardTitle>{content.fields.interests} و{content.fields.free_windows}</CardTitle><CardDescription>اختياري تمامًا.</CardDescription></CardHeader>
        <CardContent className="space-y-3"><OnboardingContext profileId={s.profile.id} /><Button asChild><Link href="/app">{content.onboarding.skip} / متابعة</Link></Button></CardContent></Card>
    </main>
  );
}
