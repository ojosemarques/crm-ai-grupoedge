import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PortabilityWorkspace } from "@/app/portabilidade/portability-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function PortabilityPage() {
  try {
    await requirePageAuthentication();
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas page-canvas-wide">
      <PageHeader
        description="Importe, exporte e atualize dados comerciais com prévia, motivo obrigatório e trilha de auditoria."
        eyebrow="Governança de dados"
        title="Portabilidade comercial"
      />
      <PortabilityWorkspace />
    </main>
  );
}
