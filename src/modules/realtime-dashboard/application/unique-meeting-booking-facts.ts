import type { PrismaClient } from "@/generated/prisma/client";
import { metricFactExclusionFilters } from "@/modules/metrics/application/metric-lead-exclusions";
import { firstMeetingBookingIds } from "../domain/unique-meeting-bookings";
import { realtimeFactPipelineId } from "../domain/realtime-dashboard-front";

export async function uniqueMeetingBookingFactIds(database: PrismaClient, input: Readonly<{
  workspaceId: string;
  to: Date;
  pipelineIds: ReadonlySet<string>;
  candidates: readonly { id: string; leadId: string | null; contactId: string | null }[];
  excludedLeadIds: readonly string[];
}>) {
  if (!input.candidates.length) return new Set<string>();
  const leadIds = [...new Set(input.candidates.flatMap(row => row.leadId ? [row.leadId] : []))];
  const leads = leadIds.length ? await database.lead.findMany({
    where: { workspaceId: input.workspaceId, id: { in: leadIds } }, select: { id: true, contactId: true },
  }) : [];
  const contactIds = [...new Set([...leads, ...input.candidates].flatMap(row => row.contactId ? [row.contactId] : []))];
  const relatedLeads = contactIds.length ? await database.lead.findMany({
    where: { workspaceId: input.workspaceId, contactId: { in: contactIds } }, select: { id: true, contactId: true },
  }) : leads;
  const contactsByLead = new Map(relatedLeads.map(lead => [lead.id, lead.contactId]));
  const allLeadIds = [...new Set([...leadIds, ...relatedLeads.map(lead => lead.id)])];
  // Do not apply the viewer's member scope here: a later booking by another
  // member cannot earn a second credit. Only candidate IDs may leave this helper.
  const history = await database.commercialMetricFact.findMany({
    where: {
      workspaceId: input.workspaceId, eventType: "MEETING_SCHEDULED", occurredAt: { lt: input.to },
      OR: [
        { id: { in: input.candidates.map(row => row.id) } },
        { leadId: { in: allLeadIds } },
        ...(contactIds.length ? [{ contactId: { in: contactIds } }] : []),
      ],
      AND: [
        ...metricFactExclusionFilters([...input.excludedLeadIds]),
        { NOT: { eventKey: { endsWith: ":front-classification:reversal:v1" } } },
        { NOT: { eventKey: { endsWith: ":test-removal:reversal:v1" } } },
      ],
    },
    select: {
      id: true, leadId: true, contactId: true, meetingId: true, quantity: true, occurredAt: true, correctionOfFactId: true,
      pipelineId: true, safeMetadata: true,
      correctionSource: { select: { pipelineId: true, safeMetadata: true } },
    },
  });
  const replacements = history.length ? await database.commercialMetricFact.findMany({
    where: { workspaceId: input.workspaceId, correctionOfFactId: { in: history.map(row => row.id) }, OR: [
      { eventKey: { endsWith: ":front-classification:replacement:v1" } },
      { eventKey: { endsWith: ":test-removal:reversal:v1" } },
    ] }, select: { correctionOfFactId: true },
  }) : [];
  const replaced = new Set(replacements.map(row => row.correctionOfFactId));
  const first = firstMeetingBookingIds(history.filter(row => !replaced.has(row.id) && input.pipelineIds.has(realtimeFactPipelineId(row) ?? ""))
    .map(row => ({ ...row, lead: row.leadId ? { contactId: contactsByLead.get(row.leadId) ?? null } : null })));
  return new Set(input.candidates.filter(row => first.has(row.id)).map(row => row.id));
}
