"use client";
import { useActionState, useEffect, useState } from "react";
import { reflectionDialogTurn, type ReflectionDialogState } from "../actions";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import { t } from "@/shared/i18n";

/** P09 بالذكاء الاصطناعي: حوار تأمل بسؤال واحد في كل دور (≤ 4 أدوار)، ويسقط إلى الأسئلة الثابتة. */
export function ReflectionDialog({ missionId, initial, gate1 }: { missionId: string; initial: ReflectionDialogState; gate1: boolean }) {
  const [state, act, pending] = useActionState(reflectionDialogTurn, null);
  const [dialog, setDialog] = useState(initial);
  const [text, setText] = useState("");
  useEffect(() => { if (state?.ok && state.data) { setDialog(state.data as ReflectionDialogState); setText(""); } }, [state]);
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
          <form action={act} className="space-y-2">
            <input type="hidden" name="mission_id" value={missionId} />
            <textarea name="text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1500} required className="w-full rounded-xl border border-input bg-background p-3" aria-label="إجابتك" />
            <Button type="submit" disabled={pending || !text.trim()}>{dialog.turn + 1 >= 4 ? t("missions.reflect_submit") : t("common.continue")}</Button>
          </form>
        )}
        {state && !state.ok && <Alert variant="error">{t("common.error_generic")} ({state.error})</Alert>}
      </CardContent>
    </Card>
  );
}
