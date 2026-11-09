"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { askForGuardian, guardianChat } from "../actions";
import { Alert, Badge, Button, Card, CardContent, Input } from "@/shared/ui";
import { t } from "@/shared/i18n";
import { createClient } from "@/shared/db/client";

export type ChatMessage = { id: string; role: "player" | "ai" | "guardian" | "system"; content: string; needs_human: boolean; safety_flagged: boolean; meta: Record<string, unknown>; created_at: string };

type Props = {
  sessionId: string | null;
  messages: ChatMessage[];
  disclosure: string;
  viewer: "player" | "guardian";
  handoff: "ai" | "guardian";
  handoffGuardianName?: string | null;
  guardianNames?: string[];
  canIntervene?: boolean;
  mode?: "free" | "comeback" | "daily_moment" | "mirror" | "weekly_review";
  intro?: string;
  realtime?: boolean;
};

function systemText(m: ChatMessage): string {
  if (m.content === "handoff_guardian") return `${(m.meta.name as string) || "المربي"} يشارك في المحادثة الآن. المرافق متوقف حتى يعيد له الكلمة.`;
  if (m.content === "handoff_back") return "عاد المرافق إلى المحادثة.";
  if (m.content === "guardian_removed") return "أُزيل المربي من المحادثة؛ المرافق يكمل.";
  return m.content;
}

export function ChatPanel(p: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(p.messages);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askState, askAction, asking] = useActionState(askForGuardian, null);
  const [gState, gAction, gPending] = useActionState(guardianChat, null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages(p.messages); }, [p.messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, streaming]);

  // AI-10: المراقبة الحية عبر Realtime (تحترم RLS)؛ تسقط بصمت محليًا
  useEffect(() => {
    if (!p.realtime || !p.sessionId) return;
    try {
      const sb = createClient();
      const ch = sb.channel(`companion:${p.sessionId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "companion_messages", filter: `session_id=eq.${p.sessionId}` }, (payload) => {
        const row = payload.new as ChatMessage;
        setMessages((ms) => (ms.some((m) => m.id === row.id) ? ms : [...ms, row]));
      }).subscribe();
      return () => { sb.removeChannel(ch); };
    } catch { return; }
  }, [p.realtime, p.sessionId]);

  async function send() {
    const text = draft.trim();
    if (!text || streaming !== null) return;
    setDraft(""); setError(null);
    setMessages((ms) => [...ms, { id: `tmp-${Date.now()}`, role: "player", content: text, needs_human: false, safety_flagged: false, meta: {}, created_at: new Date().toISOString() }]);
    setStreaming("");
    try {
      const res = await fetch("/api/companion/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, mode: p.mode ?? "free" }) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "", acc = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const part of parts) {
          const ev = /^event: (\w+)/m.exec(part)?.[1]; const dataLine = /^data: (.*)$/m.exec(part)?.[1];
          if (!ev || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (ev === "delta") { acc += data.text; setStreaming(acc); }
          if (ev === "final") { acc = data.text || acc; }
          if (ev === "error") throw new Error(data.message);
        }
      }
      setStreaming(null);
      router.refresh();
    } catch (e) {
      setStreaming(null); setError((e as Error).message);
    }
  }

  return (
    <div className="flex h-[70dvh] flex-col gap-2">
      <Alert className="text-xs">{p.disclosure}</Alert>
      {p.handoff === "guardian" && <Alert variant="warning" className="text-xs">{p.handoffGuardianName ?? "المربي"} يشارك في المحادثة الآن. المرافق متوقف حتى يعيد له الكلمة.</Alert>}
      {p.intro && messages.length === 0 && <p className="text-sm text-muted-foreground">{p.intro}</p>}
      <Card className="flex-1 overflow-y-auto"><CardContent className="space-y-2 p-3">
        {messages.map((m) => (
          m.role === "system" ? <p key={m.id} className="text-center text-xs text-muted-foreground">{systemText(m)}</p> : (
            <div key={m.id} className={`flex ${m.role === "player" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${m.role === "player" ? "bg-primary text-primary-foreground" : m.role === "guardian" ? "border border-amber-300 bg-amber-50 dark:bg-amber-950/40" : "bg-muted"}`}>
                {m.role === "guardian" && <div className="mb-1 text-xs font-semibold">{(m.meta.name as string) || "المربي"}</div>}
                {m.role === "ai" && <div className="mb-1 flex gap-1 text-xs text-muted-foreground"><span>المرافق</span>{m.safety_flagged && <Badge variant="warning">أمان</Badge>}{m.needs_human && <Badge variant="secondary">يحتاج إنسانًا</Badge>}</div>}
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          )
        ))}
        {streaming !== null && <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm">{streaming || "…"}</div></div>}
        <div ref={endRef} />
      </CardContent></Card>
      {error && <Alert variant="error" className="text-xs">{t("common.error_generic")} ({error})</Alert>}
      {p.viewer === "player" ? (
        <div className="space-y-2">
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="اكتب رسالتك" maxLength={2000} aria-label="رسالة" />
            <Button type="submit" disabled={streaming !== null || !draft.trim()}>إرسال</Button>
          </form>
          {(p.guardianNames?.length ?? 0) > 0 && (
            <form action={askAction} className="flex items-center gap-2">
              <input type="hidden" name="session_id" value={p.sessionId ?? ""} />
              <Button type="submit" variant="outline" size="sm" disabled={asking}>{t("chat.talk_to_guardian", { name: p.guardianNames![0]! })}</Button>
              {askState?.ok && <span className="text-xs text-muted-foreground">تم إخبار مربّيك.</span>}
            </form>
          )}
        </div>
      ) : (
        p.canIntervene && p.sessionId && (
          <div className="space-y-2">
            <form action={gAction} className="flex gap-2">
              <input type="hidden" name="session_id" value={p.sessionId} />
              <input type="hidden" name="action" value={p.handoff === "guardian" ? "hand_back" : "intervene"} />
              <Button type="submit" variant={p.handoff === "guardian" ? "secondary" : "default"} size="sm" disabled={gPending}>{p.handoff === "guardian" ? t("chat.hand_back") : t("chat.intervene")}</Button>
              {gState && !gState.ok && <span className="text-xs text-destructive">{t("common.not_allowed")}</span>}
            </form>
            {p.handoff === "guardian" && (
              <form action={gAction} className="flex gap-2">
                <input type="hidden" name="session_id" value={p.sessionId} />
                <input type="hidden" name="action" value="send" />
                <Input name="text" placeholder="اكتب باسمك" maxLength={2000} required aria-label="رسالة المربي" />
                <Button type="submit" size="sm" disabled={gPending}>إرسال</Button>
              </form>
            )}
          </div>
        )
      )}
    </div>
  );
}
