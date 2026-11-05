"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createGoalChain } from "../actions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/shared/ui";
import { t } from "@/shared/i18n";

type Q = { start: string; why: string; climb: string; stop_hint: string; first_step: string; naming_move: string };
type Link = { title: string; why: string };

/** P02 بلا ذكاء اصطناعي: أسئلة ثابتة، والمسودة تُكتب بكلمات المستخدم ويعدّلها بيده في أي لحظة (AI-16). */
export function GoalBuilder({ questions }: { questions: Q }) {
  const router = useRouter();
  const [links, setLinks] = useState<Link[]>([{ title: "", why: "" }]);
  const [firstStep, setFirstStep] = useState("");
  const [stopped, setStopped] = useState(false);
  const [state, action, pending] = useActionState(createGoalChain, null);
  if (state?.ok) {
    router.push("/app");
  }
  const last = links[links.length - 1]!;
  const update = (i: number, patch: Partial<Link>) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{t("goals.builder_title")}</CardTitle><CardDescription>{questions.stop_hint}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {links.map((l, i) => (
            <div key={i} className="space-y-2 rounded-xl border p-3">
              <Label htmlFor={`title-${i}`}>{i === 0 ? questions.start : questions.climb}</Label>
              <Input id={`title-${i}`} name="title" value={l.title} onChange={(e) => update(i, { title: e.target.value })} required maxLength={200} />
              <Label htmlFor={`why-${i}`}>{questions.why}</Label>
              <Input id={`why-${i}`} name="why" value={l.why} onChange={(e) => update(i, { why: e.target.value })} maxLength={1000} />
            </div>
          ))}
          {!stopped && last.title && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setLinks((ls) => [...ls, { title: last.why || "", why: "" }])}>{t("goals.builder_add_link")}</Button>
              <Button type="button" variant="ghost" onClick={() => setStopped(true)}>{t("goals.builder_stop")}</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{questions.first_step}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input name="first_step" value={firstStep} onChange={(e) => setFirstStep(e.target.value)} maxLength={200} />
          <Alert>{t("goals.chain")}: {[firstStep, ...links.map((l) => l.title)].filter(Boolean).join(" ← ") || "…"}</Alert>
          {state && !state.ok && <Alert variant="error">{state.error === "too_deep" ? t("goals.too_deep") : t("common.error_generic")}</Alert>}
          {state?.ok && <Alert variant="success">{questions.naming_move}</Alert>}
          <Button type="submit" disabled={pending || !links[0]!.title}>{t("goals.builder_done")}</Button>
        </CardContent>
      </Card>
    </form>
  );
}
