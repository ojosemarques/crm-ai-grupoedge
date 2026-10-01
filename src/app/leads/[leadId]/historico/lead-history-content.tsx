import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OperationalHistoryWorkspace } from "@/app/leads/[leadId]/historico/operational-history-workspace";
import { getOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { getLeadIntelligenceService } from "@/modules/ai/application/lead-intelligence-service";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { getContactIdentityService } from "@/modules/contacts/application/contact-identity-service";
import { getLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import type { JourneySnapshot } from "@/modules/lifecycle/domain/lifecycle-contracts";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { getPrivacyService } from "@/modules/privacy/application/privacy-service";
import { getPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { getLeadScoringService } from "@/modules/qualification/application/lead-scoring-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { ApplicationError } from "@/shared/core/errors/application-error";

export async function LeadHistoryContent({
  leadId,
  embedded = false,
}: Readonly<{
  leadId: string;
  embedded?: boolean;
}>) {
  const context = await requirePageAuthentication();
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
      getOperationalHistoryService().getLeadOperations(context, { leadId, pageSize: 20 }),
      getPactoQualificationService().getPacto(context, { leadId }),
      getLeadScoringService().getScore(context, { leadId }),
      getPreSalesPipelineService().getLeadState(context, { leadId }),
      getMeetingService().getLeadMeetings(context, { leadId }),
      getOpportunityService().getLeadScreen(context, { leadId }),
    ]);
    try {
      intelligence = await getLeadIntelligenceService().getScreen(context, { leadId });
    } catch (error) {
      if (error instanceof AccessDeniedError) intelligenceForbidden = true;
      else throw error;
    }
    try {
      contactIdentity = await getContactIdentityService().getLeadContact(context, { leadId });
      if (contactIdentity.contact) {
        journey = await getLifecycleService().getJourney(context, {
          entityType: "CONTACT",
          entityId: contactIdentity.contact.id,
        });
      }
    } catch (error) {
      if (error instanceof AccessDeniedError) contactIdentityForbidden = true;
      else throw error;
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
    if (error instanceof ApplicationError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <main className={embedded ? "p-3 sm:p-5" : "page-canvas"}>
      <nav aria-label="Navegação do contato" className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/pipeline">Negócios</Link><span aria-hidden="true">›</span>
        <Link href="/leads">Contatos</Link><span aria-hidden="true">›</span>
        <span>{operations.lead.fullName}</span>
      </nav>
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
