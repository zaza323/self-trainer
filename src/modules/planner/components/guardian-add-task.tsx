"use client";
import { useActionState } from "react";
import { guardianAddTaskAction } from "../actions-phase11";
import { Alert, Button, Input, Label, Select } from "@/shared/ui";
import { plannerContent as c } from "../labels";

export function GuardianAddTask({ profileId }: { profileId: string }) {
  const [s, act, pending] = useActionState(guardianAddTaskAction, null);
  return (
    <form action={act} className="grid gap-2 sm:grid-cols-4">
      <input type="hidden" name="profile_id" value={profileId} />
      <div className="sm:col-span-2"><Label htmlFor="gt">{c.quick_add.chips.title}</Label><Input id="gt" name="title" maxLength={200} required /></div>
      <div><Label htmlFor="gd">{c.quick_add.chips.date}</Label><Input id="gd" name="due_date" type="date" dir="ltr" /></div>
      <div><Label htmlFor="gp">{c.quick_add.chips.priority}</Label><Select id="gp" name="priority" defaultValue="none">{(["high", "medium", "low", "none"] as const).map((k) => <option key={k} value={k}>{c.priority[k]}</option>)}</Select></div>
      <div className="sm:col-span-4"><Button size="sm" type="submit" disabled={pending}>{c.guardian.add}</Button></div>
      {s?.ok && <Alert variant="success" className="text-sm sm:col-span-4">{c.guardian.added}</Alert>}
      {s && !s.ok && <Alert variant="error" className="text-sm sm:col-span-4">{(c.refusals as Record<string, string>)[s.error] ?? c.guardian.no_permission}</Alert>}
    </form>
  );
}
