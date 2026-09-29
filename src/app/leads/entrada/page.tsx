import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { LeadEntryWorkspace } from "@/app/leads/entrada/lead-entry-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getLeadEntryService } from "@/modules/leads/application/lead-entry-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export default async function LeadEntryPage() {
  const context = await requirePageAuthentication();
  let options;

  try {
    options = await getLeadEntryService().getOptions(context);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }

  return (
    <main className="page-canvas">
      <PageHeader
        description="Todos os canais aplicam a mesma normalização, deduplicação, distribuição e política SLA imediato — 0 minutos."
        eyebrow="Núcleo do lead"
        meta={`${context.displayName} · ${options.timeZone}`}
        title="Entrada de leads"
      />

      <LeadEntryWorkspace
        initialWebhookEventId={`local-${randomUUID()}`}
        options={options}
      />
    </main>
  );
}
