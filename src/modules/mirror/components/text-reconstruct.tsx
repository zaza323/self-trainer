"use client";
/** P48 الكتابة الحرة: نص ⇒ مقاطع في معاينة إلزامية قابلة للتعديل ⇒ حفظ بتأكيد صريح. */
import { startTransition, useActionState, useState } from "react";
import { reconstructTextAction, confirmTextBlocksAction } from "../actions";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, Input, Select } from "@/shared/ui";
import content from "@content/mirror.ar.json";

type Blk = { start: string; end: string; category: string; label: string | null };
type Preview = { blocks: Blk[]; unplaced: Array<{ category: string; label: string }>; source: "ai" | "deterministic" };
const t = content.reconstruct;

export function TextReconstruct({ reconstructionId, date, categories }: { reconstructionId: string; date: string; categories: Array<{ key: string; label: string }> }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, save, saving] = useActionState(confirmTextBlocksAction, null);
  const label = (k: string) => categories.find((c) => c.key === k)?.label ?? k;
  const run = () => {
    const fd = new FormData(); fd.set("reconstruction_id", reconstructionId); fd.set("date", date); fd.set("text", text); setBusy(true);
    startTransition(async () => { const r = await reconstructTextAction(null, fd); setBusy(false); if (r.ok) setPreview(r.data as Preview); });
  };
  const edit = (i: number, k: keyof Blk, v: string) => setPreview((p) => (p ? { ...p, blocks: p.blocks.map((b, j) => (j === i ? { ...b, [k]: v } : b)) } : p));
  return (
    <Card data-testid="text-reconstruct">
      <CardHeader><CardDescription>{t.free_text}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <textarea className="w-full rounded-xl border border-input bg-background p-3" value={text} onChange={(e) => setText(e.target.value)} placeholder={t.free_text_placeholder} maxLength={2000} rows={3} aria-label={t.free_text} />
        <Button type="button" variant="secondary" onClick={run} disabled={busy || text.trim().length < 3}>{t.free_text_preview}</Button>
        {preview && (
          <div className="space-y-2" data-testid="text-preview">
            <p className="text-xs text-muted-foreground">{t.free_text_note}</p>
            {preview.blocks.length === 0 && <Alert variant="info" className="text-sm">{t.free_text_none}</Alert>}
            <ul className="space-y-1">{preview.blocks.map((b, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <Input type="time" dir="ltr" className="w-28" value={b.start} onChange={(e) => edit(i, "start", e.target.value)} aria-label={t.from} />
                <Input type="time" dir="ltr" className="w-28" value={b.end} onChange={(e) => edit(i, "end", e.target.value)} aria-label={t.to} />
                <Select value={b.category} onChange={(e) => edit(i, "category", e.target.value)} aria-label={t.category}>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPreview((p) => (p ? { ...p, blocks: p.blocks.filter((_, j) => j !== i) } : p))}>✕</Button>
              </li>))}
            </ul>
            {preview.unplaced.length > 0 && <p className="text-xs text-muted-foreground">{t.free_text_unplaced} {preview.unplaced.map((u) => label(u.category)).join("، ")}</p>}
            {preview.blocks.length > 0 && (
              <form action={save}>
                <input type="hidden" name="reconstruction_id" value={reconstructionId} /><input type="hidden" name="date" value={date} /><input type="hidden" name="source" value={preview.source} />
                <input type="hidden" name="blocks" value={JSON.stringify(preview.blocks)} />
                <Button type="submit" disabled={saving}>{t.free_text_confirm}</Button>
              </form>
            )}
          </div>
        )}
        {saved?.ok && <Alert variant="success" className="text-sm">{t.free_text_saved}</Alert>}
        {saved && !saved.ok && <Alert variant="error" className="text-sm">{saved.error}</Alert>}
      </CardContent>
    </Card>
  );
}
