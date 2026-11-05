"use client";
import { useEffect, useState } from "react";

/** مؤقت يعتمد على started_at (يصمد أمام إعادة التحميل). الإشعار في الخلفية: المرحلة 6 (V1-3). */
export function Timer({ startedAt, minutes, onDone, label }: { startedAt: string; minutes: number; onDone?: () => void; label: string }) {
  const total = minutes * 60;
  const calc = () => Math.max(0, total - Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, minutes]);
  useEffect(() => { if (left === 0) onDone?.(); }, [left, onDone]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const pct = Math.round(((total - left) / total) * 100);
  return (
    <div className="space-y-2" role="timer" aria-live="polite" aria-label={label}>
      <div className="text-center text-4xl font-bold tabular-nums" dir="ltr">{mm}:{ss}</div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
