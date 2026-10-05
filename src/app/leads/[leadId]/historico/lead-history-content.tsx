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
import { getFreeQualificationService } from "@/modules/qualification/application/free-qualification-service";
import { getLeadScoringService } from "@/modules/qualification/application/lead-scoring-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { ApplicationError } from "@/shared/core/errors/application-error";

type OptionalAccessResult<T> = Readonly<{
  value: T | null;
  forbidden: boolean;
}>;

async function readOptional<T>(read: () => Promise<T>): Promise<OptionalAccessResult<T>> {
  try {
    return { value: await read(), forbidden: false };
  } catch (error) {
    if (error instanceof AccessDeniedError) return { value: null, forbidden: true };
    throw error;
  }
}

export async function LeadHistoryContent({
  leadId,
  embedded = false,
}: Readonly<{
  leadId: string;
  embedded?: boolean;
}>) {
  const context = await requirePageAuthentication();
  let operations;
  let qualifications;
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
    const [core, intelligenceResult, contactResult, privacyResult, communicationsResult] = await Promise.all([
      Promise.all([
        getOperationalHistoryService().getLeadOperations(context, { leadId, pageSize: 20 }),
        getFreeQualificationService().getScreen(context, { leadId }),
        getLeadScoringService().getScore(context, { leadId }),
        getPreSalesPipelineService().getLeadState(context, { leadId }),
        getMeetingService().getLeadMeetings(context, { leadId }),
        getOpportunityService().getLeadScreen(context, { leadId }),
      ]),
      readOptional(() => getLeadIntelligenceService().getScreen(context, { leadId })),
      readOptional(async () => {
        const identity = await getContactIdentityService().getLeadContact(context, { leadId });
        const contactJourney = identity.contact
          ? await getLifecycleService().getJourney(context, {
              entityType: "CONTACT",
              entityId: identity.contact.id,
            })
          : null;
        return { identity, journey: contactJourney };
      }),
      readOptional(() => getPrivacyService().getLeadStatus(context, leadId, "PHONE")),
      readOptional(() => getOmnichannelService().getLeadSummary(context, leadId)),
    ]);

    [operations, qualifications, score, pipeline, meetings, opportunities] = core;
    intelligence = intelligenceResult.value;
    intelligenceForbidden = intelligenceResult.forbidden;
    contactIdentity = contactResult.value?.identity ?? null;
    journey = contactResult.value?.journey ?? null;
    contactIdentityForbidden = contactResult.forbidden;
    privacy = privacyResult.value;
    privacyForbidden = privacyResult.forbidden;
    communications = communicationsResult.value;
    communicationsForbidden = communicationsResult.forbidden;
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
        initialQualifications={qualifications}
        initialPipeline={pipeline}
        initialScore={score}
        initialMeetings={meetings}
        initialOpportunities={opportunities}
        showOpportunities={!embedded}
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
