import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * عميل service_role — في الخادم فقط، ولعمليتين فقط في المرحلة 0:
 * إنشاء مستخدم auth للطفل (ACC-3) واستدعاء app.create_child_profile.
 * لا يُستخدم للقراءة العادية أبدًا (كل القراءة عبر RLS).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.includes("YOUR-")) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
