/**
 * المساحة الشخصية (GAME-1) كرسم SVG بست مراحل نمو لكل مظهر. بديل مؤقت عن Rive (V3-1).
 * المرحلة تُشتق من مستويات التدريب فقط، ولا تتراجع ولا "تحزن" بالغياب.
 */
export function SpaceIllustration({ theme, stage, label }: { theme: string; stage: number; label: string }) {
  const s = Math.min(6, Math.max(1, stage));
  const show = (n: number) => s >= n;
  const common = { role: "img" as const, "aria-label": label, viewBox: "0 0 240 140", className: "h-auto w-full max-w-sm" };
  if (theme === "garden") {
    return (
      <svg {...common}>
        <rect width="240" height="140" rx="12" fill="oklch(0.95 0.03 140)" />
        <rect x="0" y="100" width="240" height="40" fill="oklch(0.62 0.08 70)" />
        {show(1) && <ellipse cx="120" cy="104" rx="14" ry="4" fill="oklch(0.45 0.06 60)" />}
        {show(2) && <path d="M120 102 v-18" stroke="oklch(0.45 0.12 140)" strokeWidth="3" strokeLinecap="round" />}
        {show(3) && <><ellipse cx="112" cy="86" rx="8" ry="4" fill="oklch(0.6 0.15 140)" transform="rotate(-25 112 86)" /><ellipse cx="128" cy="86" rx="8" ry="4" fill="oklch(0.6 0.15 140)" transform="rotate(25 128 86)" /></>}
        {show(4) && <path d="M120 84 v-30" stroke="oklch(0.4 0.1 140)" strokeWidth="4" strokeLinecap="round" />}
        {show(5) && <circle cx="120" cy="50" r="22" fill="oklch(0.62 0.15 140)" />}
        {show(5) && <circle cx="108" cy="46" r="4" fill="oklch(0.8 0.15 20)" />}
        {show(6) && <><circle cx="130" cy="40" r="5" fill="oklch(0.7 0.18 30)" /><circle cx="114" cy="60" r="5" fill="oklch(0.7 0.18 30)" /><circle cx="134" cy="58" r="5" fill="oklch(0.7 0.18 30)" /></>}
        <circle cx="200" cy="30" r="12" fill="oklch(0.9 0.15 90)" />
      </svg>
    );
  }
  if (theme === "workshop") {
    return (
      <svg {...common}>
        <rect width="240" height="140" rx="12" fill="oklch(0.94 0.02 60)" />
        <rect x="30" y="90" width="180" height="10" fill="oklch(0.5 0.08 60)" /><rect x="40" y="100" width="8" height="30" fill="oklch(0.45 0.08 60)" /><rect x="192" y="100" width="8" height="30" fill="oklch(0.45 0.08 60)" />
        {show(2) && <rect x="60" y="76" width="22" height="12" rx="2" fill="oklch(0.5 0.05 250)" />}
        {show(3) && <><rect x="30" y="30" width="80" height="6" fill="oklch(0.5 0.08 60)" /><rect x="36" y="18" width="10" height="12" fill="oklch(0.55 0.15 30)" /><rect x="52" y="20" width="10" height="10" fill="oklch(0.55 0.15 200)" /><rect x="68" y="16" width="10" height="14" fill="oklch(0.55 0.15 120)" /></>}
        {show(4) && <path d="M120 88 l20 -30 l20 30 z" fill="oklch(0.7 0.12 60)" />}
        {show(5) && <><rect x="130" y="30" width="80" height="6" fill="oklch(0.5 0.08 60)" /><rect x="140" y="20" width="14" height="10" fill="oklch(0.6 0.1 280)" /><rect x="160" y="18" width="14" height="12" fill="oklch(0.6 0.1 20)" /></>}
        {show(6) && <><rect x="170" y="68" width="30" height="20" rx="3" fill="oklch(0.65 0.14 160)" /><circle cx="185" cy="78" r="5" fill="oklch(0.95 0 0)" /></>}
      </svg>
    );
  }
  if (theme === "observatory") {
    return (
      <svg {...common}>
        <rect width="240" height="140" rx="12" fill="oklch(0.25 0.04 270)" />
        <path d="M70 120 a50 50 0 0 1 100 0 z" fill="oklch(0.45 0.05 270)" />
        {show(2) && <path d="M120 95 l30 -40" stroke="oklch(0.8 0.05 270)" strokeWidth="5" strokeLinecap="round" />}
        {show(3) && <circle cx="180" cy="30" r="3" fill="oklch(0.95 0.1 90)" />}
        {show(4) && <><circle cx="60" cy="40" r="2" fill="#fff" /><circle cx="80" cy="25" r="2" fill="#fff" /><circle cx="100" cy="35" r="2" fill="#fff" /><path d="M60 40 L80 25 L100 35" stroke="#fff" strokeWidth="1" /></>}
        {show(5) && Array.from({ length: 14 }, (_, i) => <circle key={i} cx={20 + ((i * 37) % 200)} cy={10 + ((i * 23) % 60)} r="1.5" fill="#fff" />)}
        {show(6) && <circle cx="200" cy="25" r="10" fill="oklch(0.9 0.08 90)" />}
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect width="240" height="140" rx="12" fill="oklch(0.96 0.02 85)" />
      <rect x="0" y="105" width="240" height="35" fill="oklch(0.8 0.05 70)" />
      <rect x="160" y="20" width="50" height="40" rx="4" fill="oklch(0.85 0.08 230)" stroke="oklch(0.6 0.03 70)" strokeWidth="3" />
      {show(2) && <><rect x="40" y="80" width="60" height="6" fill="oklch(0.55 0.08 60)" /><rect x="44" y="86" width="5" height="20" fill="oklch(0.5 0.08 60)" /><rect x="91" y="86" width="5" height="20" fill="oklch(0.5 0.08 60)" /><rect x="110" y="84" width="16" height="22" rx="2" fill="oklch(0.6 0.1 30)" /></>}
      {show(3) && <><rect x="20" y="30" width="40" height="40" fill="oklch(0.6 0.08 60)" /><rect x="24" y="34" width="8" height="14" fill="oklch(0.55 0.15 20)" /><rect x="34" y="34" width="8" height="14" fill="oklch(0.55 0.15 200)" /><rect x="44" y="34" width="8" height="14" fill="oklch(0.55 0.15 120)" /></>}
      {show(4) && <><rect x="70" y="60" width="8" height="20" fill="oklch(0.45 0.1 140)" /><circle cx="74" cy="56" r="10" fill="oklch(0.6 0.15 140)" /><circle cx="140" cy="70" r="8" fill="oklch(0.92 0.15 90)" /><rect x="138" y="78" width="4" height="8" fill="oklch(0.4 0 0)" /></>}
      {show(5) && <rect x="90" y="22" width="50" height="34" rx="3" fill="oklch(0.75 0.12 330)" stroke="oklch(0.4 0.03 70)" strokeWidth="2" />}
      {show(6) && <><rect x="150" y="80" width="60" height="24" rx="6" fill="oklch(0.6 0.12 200)" /><circle cx="35" cy="95" r="10" fill="oklch(0.7 0.1 60)" /></>}
    </svg>
  );
}
