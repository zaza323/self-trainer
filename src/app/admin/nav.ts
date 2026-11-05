import type { SupabaseClient } from "@supabase/supabase-js";

export const ADMIN_NAV = [
  { href: "/admin", label: "الأمان والتكلفة" },
  { href: "/admin/templates", label: "القوالب" },
  { href: "/admin/trial", label: "التجربة المغلقة" },
];

/** ADMIN-6: سجل تدقيق لكل وصول مشرف (لا يعطّل الصفحة إن فشل). */
export async function logAdminAccess(db: SupabaseClient, path: string) {
  try { await db.rpc("log_admin_access", { p_path: path }); } catch { /* بلا قاعدة */ }
}
