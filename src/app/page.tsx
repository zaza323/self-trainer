import { redirect } from "next/navigation";
import Link from "next/link";
import { isSupabaseConfigured } from "@/shared/db/env";
import { getSession } from "@/modules/accounts";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import explainers from "@content/explainers.ar.json";

export default async function RootPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>{explainers.app_name_temp}</CardTitle>
            <CardDescription>{explainers.app_tagline}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="warning">
              Supabase غير مضبوط بعد. انسخ <code dir="ltr">.env.example</code> إلى <code dir="ltr">.env.local</code> واملأ عنوان المشروع والمفاتيح، ثم طبّق الهجرات من <code dir="ltr">supabase/migrations</code> وشغّل <code dir="ltr">pnpm config:sync</code>.
            </Alert>
          </CardContent>
        </Card>
      </main>
    );
  }
  const s = await getSession();
  if (!s) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{explainers.app_name_temp}</CardTitle>
            <CardDescription>{explainers.app_tagline}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild><Link href="/login">تسجيل الدخول</Link></Button>
            <Button asChild variant="outline"><Link href="/signup">إنشاء حساب</Link></Button>
            <Button asChild variant="ghost"><Link href="/child-login">أنا طفل ولدي رمز دخول</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }
  if (!s.profile) redirect("/onboarding");
  redirect(s.profile.kind === "guardian" ? "/guardian" : "/app");
}
