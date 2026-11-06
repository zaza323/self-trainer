"use client";
import { useActionState } from "react";
import { moveOverdueAction } from "../actions";
import { plannerContent as c, fillLabel } from "../labels";
import { Alert, Button } from "@/shared/ui";

export function MoveAllButton() {
  const [s, act, pending] = useActionState(async () => moveOverdueAction(), null);
  return (
    <form action={act} className="space-y-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{c.overdue.move_all_today}</Button>
      {s?.ok && <Alert variant="success" className="text-sm">{fillLabel(c.overdue.moved, { n: (s.data as { moved: number }).moved })}</Alert>}
    </form>
  );
}
