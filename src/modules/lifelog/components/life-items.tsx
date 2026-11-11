"use client";
/** قطع مشتركة: قائمة عناصر حقل من «سجل حياتي» (عرض، تعديل، حذف، تأكيد المتقادم) ونموذج الإضافة اليدوية (النموذج الثابت). */
import { useActionState, useState } from "react";
import { addLifeItemAction, removeLifeItemAction, editLifeItemAction, confirmLifeItemAction, type LifeRes } from "../actions";
import type { LifeField, LifeItem } from "../rules";
import { Alert, Badge, Button, Input } from "@/shared/ui";
import content from "@content/life_log.ar.json";

export const lifeErr = (s: LifeRes | null) => (s && !s.ok ? ((content.errors as Record<string, string>)[s.error] ?? s.error) : null);
export const Err = ({ s }: { s: LifeRes | null }) => { const m = lifeErr(s); return m ? <Alert variant="info" className="text-sm">{m}</Alert> : null; };

export function AddItem({ profileId, field, placeholder, label }: { profileId: string; field: LifeField; placeholder?: string; label?: string }) {
  const [s, act, pending] = useActionState(addLifeItemAction, null);
  return (
    <form action={act} className="space-y-1">
      <input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value={field} />
      <div className="flex gap-2"><Input name="text" maxLength={120} placeholder={placeholder} aria-label={label ?? content.log.add} required /><Button type="submit" size="sm" variant="outline" disabled={pending}>{label ?? content.log.add}</Button></div>
      <Err s={s} />
    </form>
  );
}

export function ItemList({ profileId, field, items, staleIds, readOnly = false, showMeta = false }: { profileId: string; field: LifeField; items: LifeItem[]; staleIds: string[]; readOnly?: boolean; showMeta?: boolean }) {
  const [, rm] = useActionState(removeLifeItemAction, null);
  const [es, edit, editing] = useActionState(editLifeItemAction, null);
  const [, confirm] = useActionState(confirmLifeItemAction, null);
  const [open, setOpen] = useState<string | null>(null);
  const active = items.filter((x) => !x.archived);
  if (!active.length) return <p className="text-xs text-muted-foreground">—</p>;
  return (
    <ul className="space-y-2" data-testid={`life-${field}`}>
      {active.map((x) => (
        <li key={x.id} className="rounded-xl border p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1">{x.text}</span>
            {!readOnly && <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === x.id ? null : x.id)}>{content.log.edit}</Button>}
            {!readOnly && <form action={rm}><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value={field} /><input type="hidden" name="id" value={x.id} /><Button type="submit" size="sm" variant="ghost">{content.log.delete}</Button></form>}
          </div>
          {showMeta && <p className="text-xs text-muted-foreground">{content.log.last_confirmed.replace("{date}", x.last_confirmed_at.slice(0, 10))} · {(content.log.sources as Record<string, string>)[x.source] ?? ""}</p>}
          {staleIds.includes(x.id) && !readOnly && (
            <form action={confirm} className="mt-1 flex flex-wrap items-center gap-2"><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value={field} /><input type="hidden" name="id" value={x.id} />
              <Badge variant="muted">{content.log.stale}</Badge><Button type="submit" size="sm" variant="outline">{content.log.confirm}</Button></form>
          )}
          {open === x.id && (
            <form action={edit} className="mt-2 flex gap-2"><input type="hidden" name="profile_id" value={profileId} /><input type="hidden" name="field" value={field} /><input type="hidden" name="id" value={x.id} />
              <Input name="text" defaultValue={x.text} maxLength={120} aria-label={content.log.edit} required /><Button type="submit" size="sm" disabled={editing}>{content.log.save}</Button></form>
          )}
        </li>
      ))}
      <Err s={es} />
    </ul>
  );
}
