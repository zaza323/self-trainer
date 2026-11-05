import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseEnv } from "./env";

/** يجدد جلسة Supabase في الكوكيز ويعيد المستخدم الحالي. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anon } = publicSupabaseEnv();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  return { response, user: data.user };
}
