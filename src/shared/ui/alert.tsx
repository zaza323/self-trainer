import * as React from "react";
import { cn } from "./cn";

export function Alert({ className, variant = "info", ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: "info" | "warning" | "error" | "success" }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
    warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
    error: "border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  }[variant];
  return <div role="status" className={cn("rounded-xl border p-4 text-sm leading-relaxed", styles, className)} {...props} />;
}
