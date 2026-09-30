import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

import "./globals.css";
import "./crm-design-system.css";

const inter = Inter({
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
    <html className={inter.variable} data-theme="light" lang="pt-BR">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
