import { redirect } from "next/navigation";

import { InstagramWorkspace } from "@/app/integracoes/instagram/instagram-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getInstagramService } from "@/modules/integrations/application/instagram-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function InstagramIntegrationPage() {
  const context = await requirePageAuthentication();
  let initial;
  try { initial = await getInstagramService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Integrações · comunicação" title="Instagram" description="Direct, comentários, menções e respostas a stories exercitados somente por fixtures locais. Meta, webhook e agente externo continuam sem homologação." />
    <InstagramWorkspace initial={initial} />
  </main>;
}
