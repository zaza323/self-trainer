"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { endRestAction } from "../actions";
import { Button } from "@/shared/ui";
import content from "@content/rest_activities.ar.json";
import patterns from "@content/breathing_patterns.json";
import stories from "@content/rest_stories.ar.json";
import quran from "@content/quran_audio_sources.json";
import type { AgeMode } from "@/shared/config";

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(v[k] ?? ""));

/** P42 مؤقت الراحة (وضع هادئ): شاشة داكنة، اسم النشاط، المتبقي، زر «رجعت» فقط؛ القيلولة تعرض نصيحة المنبّه دائمًا؛ ثم «رجعت مرتاح؟» ثم التالي. */
export function RestTimer({ sessionId, activityKey, title, plannedMin, startedAt, endsAtLabel, ageMode }: { sessionId: string; activityKey: string; title: string; plannedMin: number; startedAt: string; endsAtLabel: string; ageMode: AgeMode }) {
  const [s, act, pending] = useActionState(endRestAction, null);
  const [left, setLeft] = useState(() => Math.max(0, plannedMin * 60 - Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
  const [phase, setPhase] = useState<"timer" | "feel" | "done">("timer");
  useEffect(() => { if (phase !== "timer") return; const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000); return () => clearInterval(id); }, [phase]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
  const pattern = patterns.patterns.find((p) => p.age_modes.includes(ageMode)) ?? patterns.patterns[0]!;
  const story = stories.stories.find((x) => x.age_modes.includes(ageMode));
  const back = () => { const fd = new FormData(); fd.set("session_id", sessionId); act(fd); setPhase("feel"); };
  const feel = (f: "more" | "same" | "less") => { const fd = new FormData(); fd.set("session_id", sessionId); fd.set("feel", f); act(fd); setPhase("done"); };
  if (phase === "done") return <div className="space-y-3 text-center"><p>{content.feel_question} ✓</p><Button asChild><Link href="/app">{s?.ok ? "التالي" : "التالي"}</Link></Button></div>;
  if (phase === "feel") return <div className="space-y-3 text-center" data-testid="rest-feel"><p className="text-lg">{content.feel_question}</p><div className="flex justify-center gap-2">{(["more", "same", "less"] as const).map((k) => <Button key={k} variant="outline" type="button" disabled={pending} onClick={() => feel(k)}>{content.feel[k]}</Button>)}</div></div>;
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 rounded-2xl bg-neutral-900 p-6 text-neutral-100" data-testid="rest-timer">
      <h2 className="text-xl">{fill(content.timer_title, { activity: title })}</h2>
      <div className="font-mono text-5xl" dir="ltr">{mm}:{ss}</div>
      {activityKey === "nap" && <p className="text-sm text-neutral-300" data-testid="nap-alarm-advice">{fill(content.nap_alarm_advice, { time: endsAtLabel })}</p>}
      {activityKey === "breathing" && <div className="text-center text-sm text-neutral-300"><div className="mx-auto mb-2 h-24 w-24 animate-pulse rounded-full bg-neutral-700" aria-hidden /><span dir="ltr">{pattern.inhale} · {pattern.hold} · {pattern.exhale}</span><div>{pattern.name}</div></div>}
      {activityKey === "story_read" && story && <div className="max-w-md text-sm leading-7 text-neutral-200"><strong>{story.title}</strong><p>{story.text}</p></div>}
      {activityKey === "quran_listen" && <p className="max-w-md text-center text-sm text-neutral-300">{quran.sources.length === 0 ? quran.fallback_instruction : ""}</p>}
      <Button type="button" variant="outline" onClick={back} disabled={pending}>{content.back}</Button>
    </div>
  );
}
