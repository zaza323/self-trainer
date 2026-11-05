import { NextResponse } from "next/server";
import { createClient } from "@/shared/db/server";
export async function POST(request: Request) {
  const db = await createClient();
  await db.auth.signOut();
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
}
