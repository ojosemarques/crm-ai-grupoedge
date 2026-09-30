import type { PrismaClient } from "@/generated/prisma/client";
import { summarizeAcquisitionFunnel, type FunnelDimension, type FunnelLead } from "../domain/acquisition-funnel";

/** Called only after the media service authorizes access; no individual customer data leaves this boundary. */
export async function loadAcquisitionFunnel(database: PrismaClient, workspaceId: string, start: Date, end: Date) {
  const leads = await database.lead.findMany({
    where: { workspaceId, deletedAt: null, createdAt: { gte: start, lt: end } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10_001,
    select: {
      id: true,
      submissions: { orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 1, select: { marketingSessionId: true } },
      source: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } }, creative: { select: { id: true, name: true } },
      tags: { where: { removedAt: null, tag: { deletedAt: null } }, select: { tag: { select: { name: true } } } },
      meetings: { where: { deletedAt: null, createdAt: { lt: end } }, select: { status: true } },
      opportunities: { where: { deletedAt: null, status: "WON", closedAt: { lt: end } }, select: { amountCents: true } },
    },
  });
  let truncated = leads.length > 10_000;
  if (truncated) leads.pop();
  const sessionOwners = new Map<string, string | null>();
  for (const lead of leads) {
    const sessionId = lead.submissions[0]?.marketingSessionId;
    if (sessionId) sessionOwners.set(sessionId, sessionOwners.has(sessionId) ? null : lead.id);
  }
  const sessionIds = [...sessionOwners].filter(([, owner]) => owner !== null).map(([sessionId]) => sessionId);
  const [touchpoints, assignedTags] = leads.length ? await Promise.all([database.marketingTouchpoint.findMany({
    where: { workspaceId, OR: [{ leadId: { in: leads.map((lead) => lead.id) } }, { sessionId: { in: sessionIds } }], attributionEligible: true, occurredAt: { lt: end } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 50_001,
    select: { leadId: true, sessionId: true, utmCampaign: true, utmContent: true },
  }), database.commercialEntityTag.findMany({
    where: { workspaceId, entityType: "LEAD", entityId: { in: leads.map((lead) => lead.id) }, tag: { deletedAt: null } },
    select: { entityId: true, tag: { select: { name: true } } },
  })]) : [[], []];
  if (touchpoints.length > 50_000) { touchpoints.pop(); truncated = true; }
  const firstTouch = new Map<string, (typeof touchpoints)[number]>();
  for (const touchpoint of touchpoints) {
    const leadId = touchpoint.leadId ?? (touchpoint.sessionId ? sessionOwners.get(touchpoint.sessionId) : null);
    if (leadId && !firstTouch.has(leadId)) firstTouch.set(leadId, touchpoint);
  }
  const tagsByLead = new Map<string, string[]>();
  for (const assignment of assignedTags) tagsByLead.set(assignment.entityId, [...(tagsByLead.get(assignment.entityId) ?? []), assignment.tag.name]);
  const cohort: FunnelLead[] = leads.map((lead) => ({
    ...lead, utmCampaign: firstTouch.get(lead.id)?.utmCampaign ?? null, utmContent: firstTouch.get(lead.id)?.utmContent ?? null,
    tags: [...lead.tags.map(({ tag }) => tag.name), ...(tagsByLead.get(lead.id) ?? [])], wins: lead.opportunities.map((sale) => ({ amountCents: Number(sale.amountCents) })),
  }));
  const dimensions: FunnelDimension[] = ["source", "campaign", "creative", "utmCampaign", "utmContent"];
  return {
    cohortSize: cohort.length,
    truncated,
    byDimension: Object.fromEntries(dimensions.map((dimension) => [dimension, summarizeAcquisitionFunnel(cohort, dimension)])) as Record<FunnelDimension, ReturnType<typeof summarizeAcquisitionFunnel>>,
    method: "Leads criados no período; origem inicial e primeira UTM elegível. Agendamentos registrados até o fim e vendas fechadas até o fim do período. Status e tags refletem o cadastro atual. Agendados inclui cancelamentos; etapas contam pessoas únicas e podem se sobrepor.",
    classification: "Tier 1, Tier 2, Tier 3 e Representante usam tags explícitas. Sem tag de tier ou com tiers conflitantes: não classificado.",
  };
}
