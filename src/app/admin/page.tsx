import { redirect } from "next/navigation";
import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { AppShell } from "@/shared/ui/app-shell";
import { ADMIN_NAV, logAdminAccess } from "./nav";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import { ai } from "@/shared/config";

/** A05 طابور الأمان (ADMIN-2) + A07 التكلفة (7.5) — للمشرف (app_metadata.role = admin). */
export default async function AdminPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.isAdmin) redirect("/");
  const db = await createClient();
  await logAdminAccess(db, "/admin");
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const [{ data: flags }, { data: calls }] = await Promise.all([
    db.from("safety_flags").select("id, profile_id, category, severity, direction, status, notified_at, notified_guardian_ids, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(50),
    db.from("ai_calls").select("profile_id, function, tokens_in, tokens_out, cache_read_tokens, valid").gte("created_at", dayStart.toISOString()),
  ]);
  const rows = (calls ?? []) as Array<{ profile_id: string | null; function: string; tokens_in: number; tokens_out: number; cache_read_tokens: number; valid: boolean }>;
  const perProfile = new Map<string, { calls: number; invalid: number; tin: number; tout: number }>();
  for (const r of rows) { const k = r.profile_id ?? "—"; const v = perProfile.get(k) ?? { calls: 0, invalid: 0, tin: 0, tout: 0 }; v.calls++; if (!r.valid) v.invalid++; v.tin += r.tokens_in; v.tout += r.tokens_out; perProfile.set(k, v); }
  return (
    <AppShell title="لوحة المشرف" nav={ADMIN_NAV} user={{ name: s.profile?.display_name ?? s.email ?? "مشرف", badge: "مشرف" }}>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle className="text-base">طابور الأمان المصعّد ({(flags ?? []).length})</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          {(flags ?? []).length === 0 && <p className="text-muted-foreground">لا تنبيهات مفتوحة.</p>}
          {((flags ?? []) as Array<{ id: string; category: string; severity: string; direction: string; notified_at: string | null; notified_guardian_ids: string[]; created_at: string }>).map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
              <span><Badge variant={f.severity === "high" ? "warning" : "secondary"}>{f.category}</Badge> {f.direction} · {new Date(f.created_at).toLocaleString("ar")}</span>
              <span className="text-xs text-muted-foreground">{f.notified_at ? `أُبلغ ${f.notified_guardian_ids.length} مربٍ` : "لم يُبلَّغ أحد"}</span>
            </div>
          ))}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">تكلفة الذكاء الاصطناعي اليوم (رموز لكل مستخدم)</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
          {perProfile.size === 0 && <p className="text-muted-foreground">لا استدعاءات اليوم.</p>}
          {[...perProfile].map(([pid, v]) => <div key={pid} className="flex flex-wrap justify-between gap-2 rounded-lg border p-2"><code dir="ltr" className="text-xs">{pid.slice(0, 8)}</code><span>{v.calls} استدعاء · {v.invalid} غير صالح · {v.tin} داخل · {v.tout} خارج</span></div>)}
          <Alert className="text-xs">تنبيه التكلفة الناعم: {ai.cost_monitoring.daily_soft_alert_usd_per_profile}$ لكل مستخدم يوميًا (التحويل إلى دولار يحتاج أسعار النموذج؛ V4-6).</Alert>
        </CardContent></Card>
      </div>
    </AppShell>
  );
}
