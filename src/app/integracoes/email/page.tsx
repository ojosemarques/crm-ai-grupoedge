import { redirect } from "next/navigation";

import { EmailWorkspace } from "@/app/integracoes/email/email-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getEmailService } from "@/modules/integrations/application/email-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

export default async function EmailIntegrationPage() {
  const context = await requirePageAuthentication();
  let initial;
  try { initial = await getEmailService().screen(context); }
  catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide">
    <PageHeader eyebrow="Integrações · comunicação" title="E-mail" description="Threading, entrega, bounce, complaint e suppression validados apenas no sink local. Domínio, DNS e provider externos continuam adiados." />
    <EmailWorkspace initial={initial} />
  </main>;
}
