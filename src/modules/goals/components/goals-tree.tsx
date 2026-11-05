"use client";
import { useActionState, useState } from "react";
import { createGoal, insertGoalAbove, moveGoal, updateGoal } from "../actions";
import { buildForest, type GoalTree } from "../tree";
import type { GoalRow } from "../queries";
import { Badge, Button, Card, CardContent, Input, Label, Select } from "@/shared/ui";
import { t } from "@/shared/i18n";

function SmallForm({ action, fields, submit, hidden }: { action: (s: unknown, f: FormData) => Promise<{ ok: boolean; error?: string }>; fields: Array<{ name: string; label: string; required?: boolean }>; submit: string; hidden: Record<string, string> }) {
  const [state, act, pending] = useActionState(action as (s: unknown, f: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, null);
  return (
    <form action={act} className="mt-2 space-y-2 rounded-lg bg-muted/50 p-2">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => <div key={f.name} className="space-y-1"><Label htmlFor={`${hidden.goal_id ?? hidden.child_id ?? hidden.parent_goal_id}-${f.name}`}>{f.label}</Label><Input id={`${hidden.goal_id ?? hidden.child_id ?? hidden.parent_goal_id}-${f.name}`} name={f.name} required={f.required} /></div>)}
      <div className="flex items-center gap-2"><Button type="submit" size="sm" disabled={pending}>{submit}</Button>{state && !state.ok && <span className="text-xs text-destructive">{state.error === "cycle" ? t("goals.cycle") : state.error === "too_deep" ? t("goals.too_deep") : t("common.error_generic")}</span>}</div>
    </form>
  );
}

function Node({ tree, all, depth }: { tree: GoalTree<GoalRow>; all: GoalRow[]; depth: number }) {
  const [open, setOpen] = useState<null | "why" | "above" | "child" | "move">(null);
  const [moveState, moveAct, moving] = useActionState(moveGoal, null);
  const [statusState, statusAct] = useActionState(updateGoal, null);
  const g = tree.node;
  return (
    <li className="space-y-1">
      <Card className={g.status !== "active" ? "opacity-60" : ""}>
        <CardContent className="space-y-2 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{g.title}</div>
              <div className="text-sm text-muted-foreground">{g.why ? `لماذا: ${g.why}` : <button type="button" className="text-primary underline" onClick={() => setOpen("why")}>{t("goals.add_why")}</button>}</div>
            </div>
            <div className="flex gap-1">{depth === 1 && <Badge variant="muted">{t("goals.root")}</Badge>}{g.status !== "active" && <Badge variant="secondary">{g.status === "completed" ? t("goals.complete") : t("goals.archive")}</Badge>}</div>
          </div>
          {g.status === "active" && (
            <div className="flex flex-wrap gap-1 text-xs">
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === "above" ? null : "above")}>{t("goals.insert_above")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === "child" ? null : "child")}>{t("goals.add_child")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === "move" ? null : "move")}>{t("goals.move")}</Button>
              <form action={statusAct}><input type="hidden" name="goal_id" value={g.id} /><input type="hidden" name="status" value="completed" /><Button type="submit" size="sm" variant="ghost">{t("goals.complete")}</Button></form>
              {statusState && !statusState.ok && <span className="text-destructive">{t("common.error_generic")}</span>}
            </div>
          )}
          {open === "why" && <SmallForm action={updateGoal} fields={[{ name: "why", label: t("goals.why_label"), required: true }]} submit={t("common.save")} hidden={{ goal_id: g.id }} />}
          {open === "above" && <SmallForm action={insertGoalAbove} fields={[{ name: "title", label: t("goals.title_label"), required: true }, { name: "why", label: t("goals.why_label") }]} submit={t("common.save")} hidden={{ child_id: g.id }} />}
          {open === "child" && <SmallForm action={createGoal} fields={[{ name: "title", label: t("goals.title_label"), required: true }, { name: "why", label: t("goals.why_label") }]} submit={t("common.save")} hidden={{ parent_goal_id: g.id }} />}
          {open === "move" && (
            <form action={moveAct} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-muted/50 p-2">
              <input type="hidden" name="goal_id" value={g.id} />
              <div className="min-w-48 space-y-1"><Label htmlFor={`move-${g.id}`}>{t("goals.move")}</Label>
                <Select id={`move-${g.id}`} name="new_parent_id" defaultValue=""><option value="">{t("goals.root")}</option>{all.filter((x) => x.id !== g.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</Select></div>
              <Button type="submit" size="sm" disabled={moving}>{t("common.save")}</Button>
              {moveState && !moveState.ok && <span className="text-xs text-destructive">{moveState.error === "cycle" ? t("goals.cycle") : moveState.error === "too_deep" ? t("goals.too_deep") : t("common.error_generic")}</span>}
            </form>
          )}
        </CardContent>
      </Card>
      {tree.children.length > 0 && <ul className="ms-4 space-y-1 border-s ps-3">{tree.children.map((c) => <Node key={c.node.id} tree={c} all={all} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export function GoalsTree({ goals }: { goals: GoalRow[] }) {
  const forest = buildForest(goals);
  return <ul className="space-y-2">{forest.map((tr) => <Node key={tr.node.id} tree={tr} all={goals} depth={1} />)}</ul>;
}
