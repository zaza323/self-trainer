"use client";
import { motion } from "framer-motion";

/** الاحتفال (أ.7): خفيف ≥ 10، كامل ≥ 40. لا يظهر أبدًا عند كثافة أدنى. لا مكافآت عشوائية ولا أصوات قهرية. */
export function Celebration({ level, messages }: { level: "none" | "subtle" | "full"; messages: string[] }) {
  if (level === "none" || messages.length === 0) return null;
  if (level === "subtle") {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" role="status">
        {messages.join(" · ")}
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="relative overflow-hidden rounded-2xl border-2 border-primary bg-secondary p-5 text-center" role="status" aria-live="polite">
      {Array.from({ length: 8 }, (_, i) => (
        <motion.span key={i} aria-hidden className="absolute text-xl" style={{ left: `${10 + i * 11}%`, top: 0 }} initial={{ y: -20, opacity: 0, rotate: 0 }} animate={{ y: 90, opacity: [0, 1, 0], rotate: 180 }} transition={{ duration: 1.6, delay: i * 0.08 }}>
          {["✦", "●", "▲", "✦"][i % 4]}
        </motion.span>
      ))}
      <div className="text-lg font-bold">{messages[0]}</div>
      {messages.slice(1).map((m, i) => <div key={i} className="text-sm">{m}</div>)}
    </motion.div>
  );
}
