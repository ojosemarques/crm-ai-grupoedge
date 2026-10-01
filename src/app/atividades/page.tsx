import { SalesActivitiesWorkspace } from "@/app/atividades/sales-activities-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";

export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  await requirePageAuthentication();
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Operação comercial" title="Atividades" description="Execute todo o trabalho do dia em uma fila única, com origem, prazo e responsável claros." /><SalesActivitiesWorkspace /></main>;
}
