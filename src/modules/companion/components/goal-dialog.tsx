"use client";
import { startTransition, useActionState, useEffect, useState } from "react";
import { goalDialogTurn, confirmGoalDraft, type GoalDialogState } from "../actions";
import type { GoalBuilderOutput } from "../schemas";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";
import { AnswerInput, type AnswerValue } from "./answer-input";

/** P02 بالذكاء الاصطناعي (GOAL-2، AI-16): حوار سؤال واحد في كل مرة + مسودة حية يعدّلها المستخدم بيده في أي لحظة. */
export function GoalDialog({ initial, intro, namingMove, voiceLang }: { initial: GoalDialogState; intro: string; namingMove: string; voiceLang: string }) {
  const [state, act, pending] = useActionState(goalDialogTurn, null);
  const [, confirmAct, confirming] = useActionState(confirmGoalDraft, null);
  const [dialog, setDialog] = useState<GoalDialogState>(initial);
  const [draft, setDraft] = useState<GoalBuilderOutput["draft"]>(initial.output.draft);
  useEffect(() => { if (state?.ok && state.data) { const d = state.data as GoalDialogState; setDialog(d); setDraft(d.output.draft); } }, [state]);
  const goals = draft.goals;
  const submit = (v: AnswerValue) => {
    const fd = new FormData();
    fd.set("text", v.text); fd.set("input_method", v.input_method); fd.set("hesitation", String(v.hesitation));
    if (v.option_id) fd.set("option_id", v.option_id);
    startTransition(() => act(fd));
  };
  const update = (i: number, patch: Partial<GoalBuilderOutput["draft"]["goals"][number]>) => setDraft((d) => ({ ...d, goals: d.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">{intro}</CardTitle><CardDescription>{dialog.source === "fixed" ? "أسئلة ثابتة (المرافق غير متاح الآن)." : "المرافق ذكاء اصطناعي يسأل ولا يكتب عنك."}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {dialog.history.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}><div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.content}</div></div>
            ))}
          </div>
          {dialog.output.thinking_move_named && <Badge variant="secondary">حركة تفكير: {dialog.output.thinking_move_named}</Badge>}
          {!dialog.output.needs_user_confirmation && dialog.output.next_question && (
            <AnswerInput mode={dialog.output.response_mode} options={dialog.output.options} voiceLang={voiceLang} pending={pending} onSubmit={submit} submitLabel={t("common.continue")} />
          )}
          {state && !state.ok && <Alert variant="error">{t("common.error_generic")}</Alert>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">المسودة (بكلماتك — عدّلها في أي لحظة)</CardTitle></CardHeader>
        <CardContent>
          <form action={confirmAct} className="space-y-3">
            <input type="hidden" name="session_id" value={dialog.sessionId} />
            {goals.length === 0 && <p className="text-sm text-muted-foreground">تظهر المسودة هنا مع كل إجابة.</p>}
            {goals.map((g, i) => (
              <div key={g.temp_id} className="space-y-1 rounded-xl border p-2">
                <input type="hidden" name="parent" value={g.parent_temp_id ? String(goals.findIndex((x) => x.temp_id === g.parent_temp_id)) : ""} />
                <Label htmlFor={`t-${i}`}>{t("goals.title_label")}</Label>
                <Input id={`t-${i}`} name="title" value={g.title_user_words} onChange={(e) => update(i, { title_user_words: e.target.value })} maxLength={200} required />
                <Label htmlFor={`w-${i}`}>{t("goals.why_label")}</Label>
                <Input id={`w-${i}`} name="why" value={g.why_user_words ?? ""} onChange={(e) => update(i, { why_user_words: e.target.value })} maxLength={1000} />
              </div>
            ))}
            <Label htmlFor="first_step">الخطوة الأولى هذا الأسبوع</Label>
            <Input id="first_step" name="first_step" value={draft.first_step_user_words ?? ""} onChange={(e) => setDraft((d) => ({ ...d, first_step_user_words: e.target.value }))} maxLength={200} />
            {dialog.output.needs_user_confirmation && <Alert variant="success">{namingMove}</Alert>}
            <Button type="submit" disabled={confirming || goals.length === 0}>{t("goals.builder_done")}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
