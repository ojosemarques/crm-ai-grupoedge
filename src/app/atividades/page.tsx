import { SalesActivitiesWorkspace } from "@/app/atividades/sales-activities-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";

export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  await requirePageAuthentication();
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Operação comercial" title="Atividades" description="Priorize tarefas por prazo e revise riscos sem avanço automático." /><SalesActivitiesWorkspace /></main>;
}
