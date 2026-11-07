"use client";
/** قسم «زيادتك» (P32) وموافقة المربي (G15): نوع واحد بأزرار موافق / عدّلها / خليها نفس الوتيرة. */
import { useActionState, useState } from "react";
import { decideIncrementAction } from "../actions";
import { Alert, Button, Input, Label } from "@/shared/ui";
import content from "@content/pace.ar.json";

const r = content.review;
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
export function IncrementDecision({ id, text, canDecide, waitingGuardian, editable, guardian = false, discovery = false }: { id: string; text: string; canDecide: boolean; waitingGuardian: boolean; editable: boolean; guardian?: boolean; discovery?: boolean }) {
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
      {discovery && canDecide && !done && <p className="text-xs text-muted-foreground">{content.cap.discovery}</p>}
      {done && <Alert variant="success" className="text-sm">{r.decided}</Alert>}
      {s && !s.ok && s.error === "needs_confirm" && (
        <Alert variant="warning" className="space-y-2 text-sm" data-testid="cap-confirm">
          <p>{fill(content.cap.over_soft, { target: s.target ?? "", cap: s.cap ?? "" })}</p>
          {s.pattern ? <p>{fill(content.cap.pattern, { n: s.pattern })}</p> : null}
          <div className="flex gap-2">
            <form action={act}><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="edited" /><input type="hidden" name="target" value={String(s.target ?? "")} /><input type="hidden" name="confirm" value="yes" /><Button size="sm" type="submit" disabled={pending}>{content.cap.confirm}</Button></form>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(true)}>{content.cap.change}</Button>
          </div>
        </Alert>
      )}
      {s && !s.ok && s.error === "over_hard_cap" && <Alert variant="info" className="text-sm">{fill(content.cap.over_hard, { cap: s.cap ?? "" })}</Alert>}
      {s && !s.ok && s.error !== "needs_confirm" && s.error !== "over_hard_cap" && <Alert variant="error" className="text-sm">{(content.errors as Record<string, string>)[s.error] ?? s.error}</Alert>}
    </div>
  );
}
