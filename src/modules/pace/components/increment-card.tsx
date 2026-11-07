"use client";
/** قسم «زيادتك» (P32) وموافقة المربي (G15): نوع واحد بأزرار موافق / عدّلها / خليها نفس الوتيرة. */
import { useActionState, useState } from "react";
import { decideIncrementAction } from "../actions";
import { Alert, Button, Input, Label } from "@/shared/ui";
import content from "@content/pace.ar.json";

const r = content.review;
export function IncrementDecision({ id, text, canDecide, waitingGuardian, editable, guardian = false }: { id: string; text: string; canDecide: boolean; waitingGuardian: boolean; editable: boolean; guardian?: boolean }) {
  const [s, act, pending] = useActionState(decideIncrementAction, null);
  const [editing, setEditing] = useState(false);
  const done = s?.ok;
  return (
    <div className="space-y-2" data-testid={`increment-${id}`}>
      <p className="font-medium">{text}</p>
      {waitingGuardian && !canDecide && <p className="text-sm text-muted-foreground">{r.waiting_guardian}</p>}
      {canDecide && !done && (
        <div className="flex flex-wrap gap-2">
          <form action={act}><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="accepted" /><Button size="sm" type="submit" disabled={pending}>{guardian ? content.guardian.approve : r.accept}</Button></form>
          {editable && <Button size="sm" variant="outline" type="button" onClick={() => setEditing((e) => !e)}>{r.edit}</Button>}
          <form action={act}><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="declined" /><Button size="sm" variant="ghost" type="submit" disabled={pending}>{guardian ? content.guardian.decline : r.hold}</Button></form>
        </div>
      )}
      {editing && !done && (
        <form action={act} className="flex items-end gap-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="edited" />
          <div><Label htmlFor={`t-${id}`}>{r.target}</Label><Input id={`t-${id}`} name="target" type="number" step="any" min={0} dir="ltr" required /></div>
          <Button size="sm" type="submit" disabled={pending}>{r.save_edit}</Button>
        </form>
      )}
      {done && <Alert variant="success" className="text-sm">{r.decided}</Alert>}
      {s && !s.ok && <Alert variant="error" className="text-sm">{(content.errors as Record<string, string>)[s.error] ?? s.error}</Alert>}
    </div>
  );
}
