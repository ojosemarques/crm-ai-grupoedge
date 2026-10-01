import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { LeadListWorkspace } from "@/app/leads/lead-list-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getLeadListService } from "@/modules/leads/application/lead-list-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

type LeadListPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function LeadListPage({ searchParams }: LeadListPageProps) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  let screen;

  try {
    screen = await getLeadListService().getScreen(context, query);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT") {
      return (
        <main className="mx-auto min-h-screen w-full max-w-7xl px-5 py-8 sm:px-8">
          <article className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-950">
            <h1 className="text-2xl font-bold">Filtros inválidos</h1>
            <p className="mt-2 text-sm">{error.message}</p>
            <Link className="mt-4 inline-block font-semibold underline" href="/leads">
              Limpar filtros e voltar à lista
            </Link>
          </article>
        </main>
      );
    }
    throw error;
  }

  return (
    <main className="page-canvas">
      <PageHeader
        description="Lista operacional persistida para busca, filtros combinados e trabalho sobre o histórico do lead."
        eyebrow="Base operacional"
        title="Leads"
      />

      <LeadListWorkspace key={JSON.stringify(screen.query)} screen={screen} />
    </main>
  );
}
