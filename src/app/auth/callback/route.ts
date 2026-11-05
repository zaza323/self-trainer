import { NextResponse } from "next/server";
import { createClient } from "@/shared/db/server";

/** استبدال رمز OAuth / رابط البريد بجلسة، ثم التوجيه. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  if (code) {
    const db = await createClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
