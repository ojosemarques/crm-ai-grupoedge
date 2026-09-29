import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardView } from "@/app/dashboard/dashboard-view";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getDashboardMetricsService } from "@/modules/metrics/application/dashboard-metrics-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ApplicationError } from "@/shared/core/errors/application-error";

export type DashboardSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function DashboardPageContent({
  basePath,
  searchParams,
}: Readonly<{
  basePath: "/" | "/dashboard";
  searchParams: DashboardSearchParams;
}>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let screen;
  try {
    screen = await getDashboardMetricsService().getScreen(context, params);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT") {
      return (
        <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
          <section className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-950">
            <h1 className="text-2xl font-bold">Filtros inválidos</h1>
            <p className="mt-2 text-sm">{error.message}</p>
            <Link className="mt-4 inline-block font-semibold underline" href={`${basePath}?preset=MONTH`}>Limpar filtros e voltar</Link>
          </section>
        </main>
      );
    }
    throw error;
  }

  return (
    <main className="page-canvas page-canvas-wide">
      <DashboardView
        basePath={basePath}
        displayName={context.displayName}
        roleKey={context.roleKey}
        roleName={context.roleName}
        screen={screen}
      />
    </main>
  );
}
