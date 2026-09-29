import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  display: "swap",
  fallback: ["Arial", "sans-serif"],
  subsets: ["latin"],
  variable: "--font-politizai-sans",
  weight: "variable",
});

export const metadata: Metadata = {
  title: "Politizai CRM",
  description: "Operação comercial permanente e pós-eleitoral da Politizai.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className={plusJakartaSans.variable} lang="pt-BR">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
