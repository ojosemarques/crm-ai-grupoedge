import Link from "next/link";
import { redirect } from "next/navigation";

import { SdrQueueWorkspace } from "@/app/meu-dia/sdr-queue-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getSdrQueueService } from "@/modules/leads/application/sdr-queue-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

type MyDayPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function MyDayPage({ searchParams }: MyDayPageProps) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  let screen;

  try {
    screen = await getSdrQueueService().getScreen(context, {
      ...(typeof query.memberId === "string" ? { memberId: query.memberId } : {}),
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "INVALID_INPUT") {
      return (
        <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
          <article className="page-state__panel page-state__panel--error">
            <h1>Filtro de fila inválido</h1>
            <p className="mt-2 text-sm">{error.message}</p>
            <Link className="mt-4 inline-block font-semibold underline" href="/meu-dia">
              Voltar à minha fila
            </Link>
          </article>
        </main>
      );
    }
    throw error;
  }

  return (
    <main className="page-canvas">
      <SdrQueueWorkspace
        key={`${screen.selectedMemberId ?? "all"}:${screen.generatedAt}`}
        screen={screen}
      />
    </main>
  );
}
