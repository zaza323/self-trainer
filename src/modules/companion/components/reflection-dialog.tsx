"use client";
import { startTransition, useActionState, useEffect, useState } from "react";
import { reflectionDialogTurn, type ReflectionDialogState } from "../actions";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import { t } from "@/shared/i18n";
import { ai } from "@/shared/config";
import { AnswerInput, type AnswerValue } from "./answer-input";

/** P09 بالذكاء الاصطناعي: حوار تأمل بسؤال واحد في كل دور (≤ 4 أدوار)، ويسقط إلى الأسئلة الثابتة. */
export function ReflectionDialog({ missionId, initial, gate1, voiceLang }: { missionId: string; initial: ReflectionDialogState; gate1: boolean; voiceLang: string }) {
  const [state, act, pending] = useActionState(reflectionDialogTurn, null);
  const [dialog, setDialog] = useState(initial);
  const submit = (v: AnswerValue) => {
    const fd = new FormData();
    fd.set("mission_id", missionId); fd.set("text", v.text); fd.set("input_method", v.input_method); fd.set("hesitation", String(v.hesitation));
    if (v.option_id) fd.set("option_id", v.option_id);
    startTransition(() => act(fd));
  };
  useEffect(() => { if (state?.ok && state.data) { setDialog(state.data as ReflectionDialogState); } }, [state]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("missions.reflect_title")}</CardTitle><CardDescription>{gate1 ? t("missions.gate1_pass") : t("missions.gate1_fail")}. {dialog.source === "fixed" ? "أسئلة ثابتة." : "المرافق ذكاء اصطناعي."}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {dialog.history.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}><div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.content}</div></div>
          ))}
        </div>
        {dialog.output.thinking_move_named && <Badge variant="secondary">حركة تفكير: {dialog.output.thinking_move_named}</Badge>}
        {!dialog.output.done && (
          <AnswerInput mode={dialog.output.response_mode} options={dialog.output.options} voiceLang={voiceLang} pending={pending} long onSubmit={submit} submitLabel={dialog.turn + 1 >= ai.validation.reflection_max_turns ? t("missions.reflect_submit") : t("common.continue")} />
        )}
        {state && !state.ok && <Alert variant="error">{t("common.error_generic")} ({state.error})</Alert>}
      </CardContent>
    </Card>
  );
}
