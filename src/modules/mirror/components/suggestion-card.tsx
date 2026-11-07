"use client";
import { useActionState } from "react";
import { decideMirrorSuggestionAction } from "../actions";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import content from "@content/mirror.ar.json";

/** ط.2: اقتراح أسبوع المرآة مرة واحدة؛ «مش هلق» يمنع التكرار 30 يومًا. */
export function MirrorSuggestionCard({ id, reason }: { id: string; reason: string }) {
  const [s, act, pending] = useActionState(decideMirrorSuggestionAction, null);
  const t = content.suggestion;
  if (s?.ok) return <Alert variant="info" className="text-sm">{t.rejected}</Alert>;
  return (
    <Card data-testid="mirror-suggestion"><CardHeader><CardTitle className="text-base">{t.title}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      <p>{(t.reasons as Record<string, string>)[reason] ?? ""}</p>
      <div className="flex gap-2">
        <form action={act}><input type="hidden" name="id" value={id} /><input type="hidden" name="accept" value="true" /><Button size="sm" type="submit" disabled={pending}>{t.accept}</Button></form>
        <form action={act}><input type="hidden" name="id" value={id} /><input type="hidden" name="accept" value="false" /><Button size="sm" variant="ghost" type="submit" disabled={pending}>{t.reject}</Button></form>
      </div>
      {s && !s.ok && <Alert variant="error" className="text-sm">{s.error}</Alert>}
    </CardContent></Card>
  );
}
