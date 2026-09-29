import { redirect } from "next/navigation";

import { TelephonyWorkspace } from "@/app/integracoes/telefonia/telephony-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getTelephonyService } from "@/modules/integrations/application/telephony-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function TelephonyIntegrationPage({ searchParams }: Readonly<{ searchParams: Promise<{ leadId?: string }> }>) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  let initial;
  try { initial = await getTelephonyService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Integrações · comunicação" title="Telefonia" description="Chamadas, filas, resultados e métricas exercitados somente no simulador local determinístico. PSTN, provider, gravação e transcrição permanecem desativados." />
    <TelephonyWorkspace initial={initial} initialLeadId={query.leadId ?? ""} />
  </main>;
}
