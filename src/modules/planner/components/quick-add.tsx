"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { createTaskAction, type PlannerActionResult } from "../actions";
import { parseQuickAdd, needsAiFallback, type ParsedTask, type ParseContext } from "../nlp";
import { recurrenceLabel, reminderOffsetLabel, plannerContent as c } from "../labels";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from "@/shared/ui";
import { PLANNER_PRIORITIES, planner } from "@/shared/config";

type RecognitionCtor = new () => { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };

/**
 * P33 الإدخال السريع (ب.4): المحلّل الحتمي في المتصفح فورًا، معاينة إلزامية برقاقات قابلة للتعديل، ثم الحفظ.
 * الصوت عبر Web Speech API حيث يتوفر؛ النص يمر بالمحلّل نفسه. لا حفظ صامت.
 */
export function QuickAdd({ ctx, canUseTier1, parentTaskId = null }: { ctx: ParseContext; canUseTier1: boolean; parentTaskId?: string | null }) {
  const [state, act, pending] = useActionState(createTaskAction, null);
  const [text, setText] = useState("");
  const [method, setMethod] = useState<"manual" | "nlp" | "voice">("manual");
  const [parsed, setParsed] = useState<ParsedTask | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [voiceOk, setVoiceOk] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<InstanceType<RecognitionCtor> | null>(null);
  useEffect(() => { setVoiceOk(typeof window !== "undefined" && Boolean((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition)); }, []);
  useEffect(() => { if (state?.ok) { setText(""); setParsed(null); setDraft({}); } }, [state]);

  const preview = (raw: string, via: "nlp" | "voice") => {
    const p = parseQuickAdd(raw, ctx);
    setParsed(p); setMethod(via);
    setDraft({ title: p.title, due_date: p.due_date ?? "", due_time: p.due_time ?? "", priority: p.priority, tags: p.tags.join(" "), project: p.project ?? "", estimate_min: p.estimate_min ? String(p.estimate_min) : "", reminder_offset_min: p.reminder ? String(p.reminder.offset_min) : "" });
  };
  const voice = () => {
    if (listening) { rec.current?.stop(); return; }
    const Ctor = ((window as unknown as Record<string, RecognitionCtor>).SpeechRecognition ?? (window as unknown as Record<string, RecognitionCtor>).webkitSpeechRecognition)!;
    const r = new Ctor(); r.lang = planner.nlp.voice.lang; r.interimResults = false;
    r.onresult = (e) => { const t = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ").trim(); setText(t); preview(t, "voice"); };
    r.onend = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  };
  const save = () => {
    if (!parsed) return;
    const payload = {
      title: draft.title, priority: draft.priority, due_date: draft.due_date || null, due_time: draft.due_time || null, estimate_min: draft.estimate_min ? Number(draft.estimate_min) : null,
      recurrence: parsed.recurrence, recur_from: parsed.recur_from, tags: canUseTier1 ? draft.tags!.split(/\s+/).filter(Boolean) : [], project: canUseTier1 ? draft.project || null : null,
      parent_task_id: parentTaskId, reminder_offset_min: draft.reminder_offset_min === "" ? null : Number(draft.reminder_offset_min), created_via: method === "voice" ? "voice" : "nlp",
    };
    const fd = new FormData(); fd.set("payload", JSON.stringify(payload));
    startTransition(() => act(fd));
  };
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const Err = ({ s }: { s: PlannerActionResult | null }) => (s && !s.ok ? <Alert variant="error" className="text-sm">{(c.refusals as Record<string, string>)[s.error] ?? s.error}</Alert> : null);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{c.quick_add.title}</CardTitle><CardDescription>{c.quick_add.help}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) preview(text, "nlp"); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={c.quick_add.placeholder} maxLength={300} aria-label={c.quick_add.title} />
          <Button type="submit" disabled={!text.trim()}>{c.quick_add.preview_title}</Button>
          {voiceOk && <Button type="button" variant="outline" onClick={voice} aria-pressed={listening}>{listening ? c.quick_add.voice_stop : c.quick_add.voice_start}</Button>}
        </form>
        {parsed && (
          <div className="space-y-2 rounded-xl border p-3" data-testid="quick-add-preview">
            <div className="flex items-center gap-2"><strong className="text-sm">{c.quick_add.preview_title}</strong>{needsAiFallback(parsed) && <Badge variant="secondary">{c.quick_add.low_confidence}</Badge>}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><Label htmlFor="qa-title">{c.quick_add.chips.title}</Label><Input id="qa-title" value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required /></div>
              <div><Label htmlFor="qa-date">{c.quick_add.chips.date}</Label><Input id="qa-date" type="date" dir="ltr" value={draft.due_date} onChange={(e) => set("due_date", e.target.value)} /></div>
              <div><Label htmlFor="qa-time">{c.quick_add.chips.time}</Label><Input id="qa-time" type="time" dir="ltr" value={draft.due_time} onChange={(e) => set("due_time", e.target.value)} /></div>
              <div><Label htmlFor="qa-pr">{c.quick_add.chips.priority}</Label><Select id="qa-pr" value={draft.priority} onChange={(e) => set("priority", e.target.value)}>{PLANNER_PRIORITIES.map((p) => <option key={p} value={p}>{c.priority[p]}</option>)}</Select></div>
              <div><Label htmlFor="qa-est">{c.quick_add.chips.estimate}</Label><Input id="qa-est" type="number" dir="ltr" min={1} value={draft.estimate_min} onChange={(e) => set("estimate_min", e.target.value)} /></div>
              <div><Label htmlFor="qa-rem">{c.quick_add.chips.reminder}</Label>
                <Select id="qa-rem" value={draft.reminder_offset_min} onChange={(e) => set("reminder_offset_min", e.target.value)}>
                  <option value="">{c.quick_add.chips.none}</option>
                  <option value="0">{c.reminder.at_due}</option>
                  {planner.reminders.relative_presets_min.map((m) => <option key={m} value={String(m)}>{reminderOffsetLabel(m)}</option>)}
                  {parsed.reminder && !planner.reminders.relative_presets_min.includes(parsed.reminder.offset_min) && parsed.reminder.offset_min !== 0 && <option value={String(parsed.reminder.offset_min)}>{reminderOffsetLabel(parsed.reminder.offset_min)}</option>}
                </Select></div>
              {canUseTier1 && <div><Label htmlFor="qa-tags">{c.quick_add.chips.tags}</Label><Input id="qa-tags" value={draft.tags} onChange={(e) => set("tags", e.target.value)} /></div>}
              {canUseTier1 && <div><Label htmlFor="qa-proj">{c.quick_add.chips.project}</Label><Input id="qa-proj" value={draft.project} onChange={(e) => set("project", e.target.value)} /></div>}
            </div>
            <p className="text-xs text-muted-foreground">{c.quick_add.chips.recurrence}: {recurrenceLabel(parsed.recurrence, parsed.recur_from)}</p>
            <div className="flex gap-2">
              <Button type="button" onClick={save} disabled={pending || !draft.title?.trim()}>{c.quick_add.save}</Button>
              <Button type="button" variant="ghost" onClick={() => { setParsed(null); setDraft({}); }}>{c.quick_add.cancel}</Button>
            </div>
          </div>
        )}
        {state?.ok && <Alert variant="success" className="text-sm">{c.quick_add.saved}</Alert>}
        <Err s={state} />
      </CardContent>
    </Card>
  );
}
