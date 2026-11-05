"use client";
import { useActionState } from "react";
import Link from "next/link";
import { signInWithEmail, signUpWithEmail, signInChild, signInWithGoogle, type ActionResult } from "@/modules/accounts/actions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";

function Feedback({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  if (state.ok) return <Alert variant="success">{state.message === "check_email" ? t("auth.check_email") : "تم"}</Alert>;
  return <Alert variant="error">{state.error === "invalid_credentials" ? t("auth.invalid") : t("common.error_generic")}</Alert>;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInWithEmail, null);
  return (
    <Card>
      <CardHeader><CardTitle>{t("auth.login")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="space-y-3">
          <input type="hidden" name="next" value={next ?? "/"} />
          <div className="space-y-1"><Label htmlFor="email">{t("auth.email")}</Label><Input id="email" name="email" type="email" dir="ltr" required autoComplete="email" /></div>
          <div className="space-y-1"><Label htmlFor="password">{t("auth.password")}</Label><Input id="password" name="password" type="password" dir="ltr" required autoComplete="current-password" /></div>
          <Feedback state={state} />
          <Button type="submit" className="w-full" disabled={pending}>{t("auth.login")}</Button>
        </form>
        <form action={signInWithGoogle}><Button type="submit" variant="outline" className="w-full">{t("auth.google")}</Button></form>
        <p className="text-sm text-muted-foreground">{t("auth.no_account")} <Link className="text-primary underline" href="/signup">{t("auth.signup")}</Link></p>
        <p className="text-sm"><Link className="text-primary underline" href="/child-login">{t("auth.child_login_link")}</Link></p>
      </CardContent>
    </Card>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpWithEmail, null);
  return (
    <Card>
      <CardHeader><CardTitle>{t("auth.signup")}</CardTitle><CardDescription>للمراهقين والبالغين والمربين. حساب الطفل ينشئه المربي من لوحته.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="space-y-3">
          <div className="space-y-1"><Label htmlFor="email">{t("auth.email")}</Label><Input id="email" name="email" type="email" dir="ltr" required autoComplete="email" /></div>
          <div className="space-y-1"><Label htmlFor="password">{t("auth.password")}</Label><Input id="password" name="password" type="password" dir="ltr" required minLength={8} autoComplete="new-password" /></div>
          <Feedback state={state} />
          <Button type="submit" className="w-full" disabled={pending}>{t("auth.signup")}</Button>
        </form>
        <form action={signInWithGoogle}><Button type="submit" variant="outline" className="w-full">{t("auth.google")}</Button></form>
        <p className="text-sm text-muted-foreground">{t("auth.have_account")} <Link className="text-primary underline" href="/login">{t("auth.login")}</Link></p>
      </CardContent>
    </Card>
  );
}

export function ChildLoginForm({ explainer }: { explainer: string }) {
  const [state, action, pending] = useActionState(signInChild, null);
  return (
    <Card>
      <CardHeader><CardTitle>{t("auth.child_login")}</CardTitle><CardDescription>{explainer}</CardDescription></CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1"><Label htmlFor="login_code">{t("auth.login_code")}</Label><Input id="login_code" name="login_code" dir="ltr" required autoComplete="username" /></div>
          <div className="space-y-1"><Label htmlFor="password">{t("auth.password")}</Label><Input id="password" name="password" type="password" dir="ltr" required autoComplete="current-password" /></div>
          <Feedback state={state} />
          <Button type="submit" className="w-full" size="lg" disabled={pending}>{t("auth.login")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
