import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseEnv } from "./env";

/** عميل الخادم بجلسة المستخدم الحالي — كل استعلام يمر عبر RLS. */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anon } = publicSupabaseEnv();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // يُستدعى من مكوّن خادم: الوسيط (middleware) هو من يجدد الجلسة.
        }
      },
    },
  });
}
