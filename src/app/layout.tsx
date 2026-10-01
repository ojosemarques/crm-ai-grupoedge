import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell, type AppShellSession } from "@/components/layout/app-shell";
import { getOptionalPageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";

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
  title: "Grupo Edge CRM",
  description: "Gestão comercial, relacionamento e operação do Grupo Edge.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const context = await getOptionalPageAuthentication();
  const initialSession: AppShellSession | null = context ? {
    id: context.sessionId,
    user: {
      displayName: context.displayName,
      email: context.email ?? "",
      role: { key: context.roleKey, name: context.roleName },
      permissionKeys: await getAuthorizationService().getEffectivePermissionKeys(context),
    },
    workspace: {
      slug: context.workspaceSlug,
      name: context.workspaceName ?? context.workspaceSlug,
      count: context.workspaceCount ?? 1,
    },
  } : null;
  return (
    <html className={inter.variable} data-theme="light" lang="pt-BR">
      <body><AppShell initialSession={initialSession}>{children}</AppShell></body>
    </html>
  );
}
