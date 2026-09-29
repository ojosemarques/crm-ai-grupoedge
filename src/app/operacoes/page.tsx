import { redirect } from "next/navigation";

import { OperationsWorkspace } from "@/app/operacoes/operations-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOperationsService } from "@/modules/operations/application/operations-service";
import { operationsListQuerySchema } from "@/modules/operations/domain/operations-contracts";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function OperationsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const rawSearchParams = await searchParams;
  const parsedQuery = operationsListQuerySchema.safeParse({
    page: typeof rawSearchParams.page === "string" ? rawSearchParams.page : undefined,
    pageSize: typeof rawSearchParams.pageSize === "string" ? rawSearchParams.pageSize : undefined,
    tab: typeof rawSearchParams.tab === "string" ? rawSearchParams.tab : undefined,
  });
  const query = parsedQuery.success ? parsedQuery.data : operationsListQuerySchema.parse({});
  let screen: Awaited<ReturnType<ReturnType<typeof getOperationsService>["getScreen"]>>;
  try {
    screen = await getOperationsService().getScreen(context, query);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Operação governada" title="Observabilidade, segurança e resiliência" description="Sinais locais sem PII, alertas determinísticos, incidentes rastreáveis, privacidade e evidências de recuperação." meta={`Atualizado em ${new Intl.DateTimeFormat("pt-BR", { timeZone: screen.timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(screen.generatedAt))}`} />
    <OperationsWorkspace initial={screen} initialTab={query.tab} />
  </main>;
}
