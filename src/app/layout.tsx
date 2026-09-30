import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

import "./globals.css";
import "./crm-design-system.css";

const poppins = Poppins({
  display: "swap",
  fallback: ["Arial", "sans-serif"],
  subsets: ["latin"],
  variable: "--font-politizai-sans",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Politizai CRM",
  description: "Operação comercial permanente e pós-eleitoral da Politizai.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className={poppins.variable} data-theme="light" lang="pt-BR">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
