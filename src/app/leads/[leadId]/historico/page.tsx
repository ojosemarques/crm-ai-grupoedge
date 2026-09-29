import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { OperationalHistoryWorkspace } from "@/app/leads/[leadId]/historico/operational-history-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { getLeadScoringService } from "@/modules/qualification/application/lead-scoring-service";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { getLeadIntelligenceService } from "@/modules/ai/application/lead-intelligence-service";
import { getContactIdentityService } from "@/modules/contacts/application/contact-identity-service";
import { getLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import { getPrivacyService } from "@/modules/privacy/application/privacy-service";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import type { JourneySnapshot } from "@/modules/lifecycle/domain/lifecycle-contracts";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

export default async function LeadHistoryPage({
  params,
}: Readonly<{ params: Promise<{ leadId: string }> }>) {
  const context = await requirePageAuthentication();
  const { leadId } = await params;
  let operations;
  let pacto;
  let score;
  let pipeline;
  let meetings;
  let opportunities;
  let intelligence = null;
  let intelligenceForbidden = false;
  let contactIdentity = null;
  let contactIdentityForbidden = false;
  let journey: JourneySnapshot | null = null;
  let privacy = null;
  let privacyForbidden = false;
  let communications = null;
  let communicationsForbidden = false;

  try {
    [operations, pacto, score, pipeline, meetings, opportunities] = await Promise.all([
      getOperationalHistoryService().getLeadOperations(context, {
        leadId,
        pageSize: 20,
      }),
      getPactoQualificationService().getPacto(context, { leadId }),
      getLeadScoringService().getScore(context, { leadId }),
      getPreSalesPipelineService().getLeadState(context, { leadId }),
      getMeetingService().getLeadMeetings(context, { leadId }),
      getOpportunityService().getLeadScreen(context, { leadId }),
    ]);
    try {
      intelligence = await getLeadIntelligenceService().getScreen(context, { leadId });
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        intelligenceForbidden = true;
      } else {
        throw error;
      }
    }
    try {
      contactIdentity = await getContactIdentityService().getLeadContact(context, { leadId });
      if (contactIdentity.contact) journey = await getLifecycleService().getJourney(context, { entityType: "CONTACT", entityId: contactIdentity.contact.id });
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        contactIdentityForbidden = true;
      } else {
        throw error;
      }
    }
    try {
      privacy = await getPrivacyService().getLeadStatus(context, leadId, "PHONE");
    } catch (error) {
      if (error instanceof AccessDeniedError) privacyForbidden = true;
      else throw error;
    }
    try {
      communications = await getOmnichannelService().getLeadSummary(context, leadId);
    } catch (error) {
      if (error instanceof AccessDeniedError) communicationsForbidden = true;
      else throw error;
    }
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  return (
    <main className="page-canvas">
      <PageHeader
        actions={<Button asChild><Link href={`/integracoes/telefonia?leadId=${leadId}`}>Abrir telefonia local</Link></Button>}
        back={{ href: "/leads", label: "Voltar à lista de leads" }}
        description="Contexto centralizado, ações operacionais, tarefas e timeline imutável."
        eyebrow="Lead 360"
        meta={`Dados exibidos em ${operations.timeZone}`}
        title="Cartão 360 do lead"
      />

      <OperationalHistoryWorkspace
        initialOperations={operations}
        initialPacto={pacto}
        initialPipeline={pipeline}
        initialScore={score}
        initialMeetings={meetings}
        initialOpportunities={opportunities}
        initialIntelligence={intelligence}
        intelligenceForbidden={intelligenceForbidden}
        initialContactIdentity={contactIdentity}
        contactIdentityForbidden={contactIdentityForbidden}
        initialJourney={journey}
        initialPrivacy={privacy}
        privacyForbidden={privacyForbidden}
        initialCommunications={communications}
        communicationsForbidden={communicationsForbidden}
      />
    </main>
  );
}
