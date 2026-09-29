import { redirect } from "next/navigation";

import { AuditWorkspace } from "@/app/auditoria/audit-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { getAuditAdministrationService } from "@/modules/audit/application/audit-administration-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AuditPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  let screen;
  try {
    screen = await getAuditAdministrationService().getScreen(context, await searchParams);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader description="Alterações append-only, evidências concretas e violações detectadas por regras determinísticas." eyebrow="Governança" meta={context.displayName} title="Auditoria e saúde do processo" />
      <AuditWorkspace initialScreen={screen} />
    </main>
  );
}
