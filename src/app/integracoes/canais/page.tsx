import { redirect } from "next/navigation";

import { ChannelReadinessWorkspace } from "@/app/integracoes/canais/channel-readiness-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getStage09ReadinessService } from "@/modules/integrations/application/stage09-readiness-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function ChannelReadinessPage() {
  const context = await requirePageAuthentication();
  let initial;
  try { initial = await getStage09ReadinessService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Integrações · aceite" title="Matriz de canais" description="Provas locais e gates externos por canal, sem converter fixtures em homologação de provider." /><ChannelReadinessWorkspace initial={initial} /></main>;
}
