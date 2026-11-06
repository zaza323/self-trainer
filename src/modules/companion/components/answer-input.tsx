"use client";
import { useEffect, useRef, useState } from "react";
import type { ChoiceOption } from "../response-mode/options";
import type { ResponseMode } from "@/shared/config";
import { Button, Input } from "@/shared/ui";
import { t } from "@/shared/i18n";

type RecognitionCtor = new () => { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };

/** زر الصوت (Web Speech API): يظهر حيث يتوفر فقط (أ.1)؛ النص الناتج يُعدَّل قبل الإرسال. */
function VoiceButton({ lang, onText, onStart }: { lang: string; onText: (s: string) => void; onStart: () => void }) {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<InstanceType<RecognitionCtor> | null>(null);
  useEffect(() => { setAvailable(typeof window !== "undefined" && Boolean((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition)); }, []);
  if (!available) return null;
  const toggle = () => {
    if (listening) { rec.current?.stop(); return; }
    const Ctor = ((window as unknown as Record<string, RecognitionCtor>).SpeechRecognition ?? (window as unknown as Record<string, RecognitionCtor>).webkitSpeechRecognition)!;
    const r = new Ctor();
    r.lang = lang; r.interimResults = false;
    r.onresult = (e) => { onText(Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ").trim()); };
    r.onend = () => setListening(false);
    rec.current = r; onStart(); setListening(true); r.start();
  };
  return <Button type="button" variant="outline" size="sm" onClick={toggle} aria-pressed={listening}>{listening ? t("chat.voice_stop") : t("chat.voice_start")}</Button>;
}

export type AnswerValue = { text: string; option_id: string | null; input_method: "typed" | "voice" | "option"; hesitation: number };

/**
 * حقل الرد بحسب شكل الرد الذي قرره الخادم (0.4 أ.1): أزرار سريعة، أو خيارات + «غير ذلك»، أو كتابة + صوت.
 * يقيس زمن التردد (لتفعيل stuck) ويرسل طريقة الإدخال. السياسة كلها في الخادم؛ هذه الواجهة تعرض فقط.
 */
export function AnswerInput({ mode, options, voiceLang, pending, onSubmit, long = false, placeholder, submitLabel }: {
  mode: ResponseMode; options: ChoiceOption[]; voiceLang: string; pending: boolean; onSubmit: (v: AnswerValue) => void; long?: boolean; placeholder?: string; submitLabel: string;
}) {
  const shownAt = useRef(Date.now());
  const [text, setText] = useState("");
  const [method, setMethod] = useState<"typed" | "voice">("typed");
  const [other, setOther] = useState(false);
  useEffect(() => { shownAt.current = Date.now(); setText(""); setMethod("typed"); setOther(false); }, [mode, options]);
  const secs = () => Math.round((Date.now() - shownAt.current) / 1000);
  const showTextField = mode === "free_text" || other;

  return (
    <div className="space-y-2">
      {mode !== "free_text" && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("chat.options")}>
          {options.map((o) => (
            <Button key={o.id} type="button" variant="outline" size="sm" disabled={pending} onClick={() => onSubmit({ text: "", option_id: o.id, input_method: "option", hesitation: secs() })}>{o.label}</Button>
          ))}
          {mode === "choices_plus_other" && !other && <Button type="button" variant="ghost" size="sm" onClick={() => setOther(true)}>{t("chat.other")}</Button>}
        </div>
      )}
      {showTextField && (
        <div className="space-y-2">
          {long
            ? <textarea value={text} onChange={(e) => { setText(e.target.value); setMethod("typed"); }} rows={2} maxLength={1500} className="w-full rounded-xl border border-input bg-background p-3" aria-label={t("chat.your_answer")} placeholder={placeholder} />
            : <Input value={text} onChange={(e) => { setText(e.target.value); setMethod("typed"); }} maxLength={1000} aria-label={t("chat.your_answer")} placeholder={placeholder} />}
          <div className="flex items-center gap-2">
            <Button type="button" disabled={pending || !text.trim()} onClick={() => onSubmit({ text: text.trim(), option_id: null, input_method: method, hesitation: secs() })}>{submitLabel}</Button>
            <VoiceButton lang={voiceLang} onStart={() => setMethod("voice")} onText={(s) => { setText((prev) => (prev ? `${prev} ${s}` : s)); setMethod("voice"); }} />
          </div>
        </div>
      )}
    </div>
  );
}
