import { redirect } from "next/navigation";
import { CustomerSuccessWorkspace, type CustomerSuccessScreenView } from "@/app/customer-success/customer-success-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getCustomerSuccessService } from "@/modules/customer-success/application/customer-success-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function CustomerSuccessPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  const query = Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  let screen;
  try { screen = await getCustomerSuccessService().screen(context, query); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Pós-venda" title="Customer Success" description="Carteira acionável, planos de resultado e saúde explicada por evidências persistidas." meta={`${context.displayName} · ${screen.timeZone}`} />
    <CustomerSuccessWorkspace screen={JSON.parse(JSON.stringify(screen)) as CustomerSuccessScreenView} />
  </main>;
}
