import { getSession } from "@/modules/accounts";
import { createClient } from "@/shared/db/server";
import { ContextEditor } from "@/modules/adaptation/components/context-editor";
import { emptyContext, type ContextField } from "@/modules/adaptation";
import { t } from "@/shared/i18n";

/** P03 سياق الحياة + اقتراحات المرافق (ADAPT-1، ADAPT-2). */
export default async function ContextPage() {
  const s = (await getSession())!;
  const db = await createClient();
  const [{ data: pc }, { data: sug }] = await Promise.all([
    db.from("personal_context").select("interests, routine, free_windows, contexts").eq("profile_id", s.profile!.id).maybeSingle(),
    db.from("context_suggestions").select("id, field, value").eq("profile_id", s.profile!.id).eq("status", "pending"),
  ]);
  const ctx = pc ? { interests: (pc.interests as string[]) ?? [], routine: (pc.routine as string[]) ?? [], free_windows: (pc.free_windows as string[]) ?? [], contexts: (pc.contexts as string[]) ?? [] } : emptyContext();
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{t("nav.context")}</h2><ContextEditor profileId={s.profile!.id} context={ctx} suggestions={(sug ?? []) as Array<{ id: string; field: ContextField; value: string }>} /></div>;
}
