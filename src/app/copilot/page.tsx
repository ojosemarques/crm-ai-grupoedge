import Link from "next/link";
import { redirect } from "next/navigation";

import { CopilotView } from "@/app/copilot/copilot-view";
import { PageHeader } from "@/components/layout/page-header";
import { getManagerCopilotService } from "@/modules/ai/application/manager-copilot-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CopilotPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  let shell;
  try {
    shell = await getManagerCopilotService().getShell(context, await searchParams);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT") {
      return <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16"><section className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-950"><h1 className="text-2xl font-bold">Filtros inválidos</h1><p className="mt-2 text-sm">{error.message}</p><Link className="mt-4 inline-block font-semibold underline" href="/copilot?preset=MONTH">Limpar filtros e voltar</Link></section></main>;
    }
    throw error;
  }
  return (
    <main className="page-canvas">
      <PageHeader
        description="Perguntas predefinidas respondidas por métricas persistidas, registros rastreáveis e limitações explícitas."
        eyebrow="Inteligência explicável"
        meta={`${context.displayName} · ${shell.timeZone}`}
        title="Copilot gerencial"
      />
      <CopilotView shell={shell} />
    </main>
  );
}
