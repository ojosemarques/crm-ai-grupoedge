import { redirect } from "next/navigation";

import { WhatsAppWorkspace } from "@/app/integracoes/whatsapp/whatsapp-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getWhatsAppService } from "@/modules/integrations/application/whatsapp-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const context = await requirePageAuthentication();
  let initial;
  try { initial = await getWhatsAppService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Integrações · comunicação" title="WhatsApp" description="Canal externo bloqueado pelo gate de elegibilidade. Contratos, controles e simulador permanecem locais, sem tráfego para a Meta." />
    <WhatsAppWorkspace initial={initial} />
  </main>;
}
