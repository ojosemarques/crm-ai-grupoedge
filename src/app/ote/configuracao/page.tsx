import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOteService } from "@/modules/ote/application/ote-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { OteAdmin } from "./ote-admin";

export const dynamic = "force-dynamic";
export default async function OteConfigurationPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  let screen;
  try {
    screen = await getOteService().administration(context, query.month ? { month: query.month } : {});
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Administração · acesso restrito" title="Planos de remuneração" description="Configure o plano individual e confira as evidências que compõem o OTE de cada pessoa." /><OteAdmin screen={screen} /></main>;
}
