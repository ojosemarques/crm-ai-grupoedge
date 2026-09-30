import type { PrismaClient } from "@/generated/prisma/client";
import { PAYMENT_PROVIDER_KEY } from "@/modules/payments/domain/payment-contracts";
import { summarizeAcquisitionFunnel, summarizeAcquisitionReceipts, type AcquisitionReceipt, type FunnelDimension, type FunnelLead } from "../domain/acquisition-funnel";

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
      opportunities: { select: { id: true, amountCents: true, status: true, closedAt: true, deletedAt: true } },
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
  // Map immutable IDs separately from touchpoints so one receipt is never
  // multiplied by the number of visits, proposals or attribution dimensions.
  const leadByOpportunity = new Map(leads.flatMap((lead) => lead.opportunities.map((opportunity) => [opportunity.id, lead.id] as const)));
  // Start with period cash events, avoiding an unbounded scan of all future
  // installments for the cohort's subscriptions.
  const payments = leadByOpportunity.size ? await database.payment.findMany({
    where: { workspaceId, providerKey: { not: PAYMENT_PROVIDER_KEY }, occurredAt: { lt: end }, OR: [{ occurredAt: { gte: start, lt: end } }, { reversedAt: { gte: start, lt: end } }] },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 50_001,
    select: { id: true, invoiceId: true, amountCents: true, currency: true, providerKey: true, status: true, occurredAt: true, reversedAt: true },
  }) : [];
  if (payments.length > 50_000) { payments.pop(); truncated = true; }
  const invoices = payments.length ? await database.invoice.findMany({ where: { workspaceId, id: { in: [...new Set(payments.map((payment) => payment.invoiceId))] } }, select: { id: true, contractId: true, currency: true } }) : [];
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const contracts = invoices.length ? await database.commercialContract.findMany({ where: { workspaceId, id: { in: [...new Set(invoices.map((invoice) => invoice.contractId))] } }, select: { id: true, opportunityId: true } }) : [];
  const leadByContract = new Map(contracts.map((contract) => [contract.id, leadByOpportunity.get(contract.opportunityId)]));
  const paymentsByLead = new Map<string, AcquisitionReceipt[]>();
  for (const payment of payments) {
    const invoice = invoiceById.get(payment.invoiceId);
    const leadId = invoice && leadByContract.get(invoice.contractId);
    if (!invoice || !leadId) continue;
    const rows = paymentsByLead.get(leadId) ?? [];
    rows.push({ ...payment, amountCents: payment.amountCents.toString(), invoiceCurrency: invoice.currency });
    paymentsByLead.set(leadId, rows);
  }
  const cohort: FunnelLead[] = leads.map((lead) => ({
    ...lead, utmCampaign: firstTouch.get(lead.id)?.utmCampaign ?? null, utmContent: firstTouch.get(lead.id)?.utmContent ?? null,
    tags: [...lead.tags.map(({ tag }) => tag.name), ...(tagsByLead.get(lead.id) ?? [])], wins: lead.opportunities.filter((sale) => !sale.deletedAt && sale.status === "WON" && sale.closedAt && sale.closedAt < end).map((sale) => ({ amountCents: Number(sale.amountCents) })),
    receipts: summarizeAcquisitionReceipts(paymentsByLead.get(lead.id) ?? [], start, end),
  }));
  const dimensions: FunnelDimension[] = ["source", "campaign", "creative", "utmCampaign", "utmContent"];
  return {
    cohortSize: cohort.length,
    truncated,
    excludedReceiptCount: cohort.reduce((sum, lead) => sum + (lead.receipts?.excludedCount ?? 0), 0),
    receiptCurrency: "BRL" as const,
    byDimension: Object.fromEntries(dimensions.map((dimension) => [dimension, summarizeAcquisitionFunnel(cohort, dimension)])) as Record<FunnelDimension, ReturnType<typeof summarizeAcquisitionFunnel>>,
    method: "Leads criados no período; origem inicial e primeira UTM elegível. Agendamentos registrados até o fim e vendas fechadas até o fim do período. Status e tags refletem o cadastro atual. Agendados inclui cancelamentos; etapas contam pessoas únicas e podem se sobrepor.",
    receiptMethod: "Recebimentos em BRL confirmados para cobranças dos leads desta coorte, pela data do pagamento; estornos pela data da reversão. Recebido líquido = recebido bruto − estornos do período. Cada pagamento é contado uma vez por dimensão, inclusive em Não identificado quando não há atribuição. Exclui simulações, entradas financeiras avulsas e clientes de coortes anteriores; não representa todo o caixa da empresa. Vendas contratadas e recebimentos são medidas diferentes.",
    classification: "Tier 1, Tier 2, Tier 3 e Representante usam tags explícitas. Sem tag de tier ou com tiers conflitantes: não classificado.",
  };
}
