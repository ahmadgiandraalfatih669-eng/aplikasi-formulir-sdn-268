import type { Metadata, Viewport } from "next";
import { QueryProvider } from "./query-provider";
import { ThemeToggle } from "./theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Formulir & Penilaian SDN 268",
  description: "Portal formulir, kuis, dan penilaian SDN 268 Panyileukan.",
  icons: { icon: "/logo-sdn-268.png" },
  manifest: "/manifest.webmanifest",
  applicationName: "SDN 268 Panyileukan",
};

export const viewport: Viewport = {
  themeColor: "#0A0F1F",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body><QueryProvider>{children}</QueryProvider><ThemeToggle /></body>
    </html>
  );
}
