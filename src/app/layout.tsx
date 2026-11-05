import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DEFAULT_LOCALE, dir } from "@/shared/i18n";
import explainers from "@content/explainers.ar.json";

export const metadata: Metadata = {
  title: explainers.app_name_temp,
  description: explainers.app_tagline,
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2f7a62" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} dir={dir(DEFAULT_LOCALE)}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
