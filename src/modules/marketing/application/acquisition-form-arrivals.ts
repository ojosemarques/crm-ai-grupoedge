import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { marketingFormDefinitionSchema } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import type { FunnelLead } from "../domain/acquisition-funnel";

const destinationSchema = z.object({ destination: marketingFormDefinitionSchema.shape.destination });

/** Only aggregate attribution fields are read; respondent identities stay in Forms. */
export async function loadAcquisitionFormArrivals(database: Prisma.TransactionClient, workspaceId: string, start: Date, end: Date, pipelineName?: string) {
  const responses = await database.marketingFormPartialResponse.findMany({
    where: { workspaceId, deletedAt: null, firstAnsweredAt: { gte: start, lt: end } },
    orderBy: [{ firstAnsweredAt: "asc" }, { id: "asc" }], take: 10_001,
    select: { id: true, marketingFormId: true, marketingFormVersionId: true, completedAt: true, receiptId: true, utmCampaign: true, utmContent: true },
  });
  const truncated = responses.length > 10_000;
  if (truncated) responses.pop();
  const pending = responses.filter((response) => !response.completedAt);
  const [forms, versions, pipelines] = pending.length ? await Promise.all([
    database.marketingForm.findMany({ where: { workspaceId, id: { in: [...new Set(pending.map((row) => row.marketingFormId))] }, deletedAt: null }, select: { id: true } }),
    database.marketingFormVersion.findMany({ where: { workspaceId, id: { in: [...new Set(pending.map((row) => row.marketingFormVersionId))] } }, select: { id: true, definition: true } }),
    database.pipeline.findMany({ where: { workspaceId, entityType: "LEAD", deletedAt: null, ...(pipelineName ? { name: pipelineName } : {}) }, select: { id: true } }),
  ]) : [[], [], []];
  const activeForms = new Set(forms.map((form) => form.id));
  const allowedPipelines = new Set(pipelines.map((pipeline) => pipeline.id));
  const destinations = new Map(versions.map((version) => [version.id, destinationSchema.parse(version.definition).destination]));
  const sources = destinations.size ? await database.leadSource.findMany({
    where: { workspaceId, key: { in: [...new Set([...destinations.values()].map((destination) => destination.sourceKey))] } }, select: { id: true, key: true, name: true },
  }) : [];
  const sourceByKey = new Map(sources.map((source) => [source.key, { id: source.id, name: source.name }]));
  const incomplete: FunnelLead[] = pending.flatMap((response) => {
    const destination = destinations.get(response.marketingFormVersionId);
    if (!activeForms.has(response.marketingFormId) || !destination || !allowedPipelines.has(destination.pipelineId)) return [];
    return [{ id: `partial:${response.id}`, source: sourceByKey.get(destination.sourceKey) ?? null, campaign: null, creative: null, utmCampaign: response.utmCampaign, utmContent: response.utmContent, tags: [], meetings: [], wins: [] }];
  });
  return { incomplete, completedReceiptIds: responses.flatMap((response) => response.completedAt && response.receiptId ? [response.receiptId] : []), truncated };
}

/** Completion replaces the partial entry while retaining its first arrival day. */
export async function loadLeadArrivalDates(database: Prisma.TransactionClient, workspaceId: string, leads: readonly { id: string; createdAt: Date }[]) {
  const dates = new Map(leads.map((lead) => [lead.id, lead.createdAt]));
  if (!leads.length) return { dates, truncated: false };
  const submissions = await database.leadFormSubmission.findMany({
    where: { workspaceId, leadId: { in: leads.map((lead) => lead.id) }, marketingFormReceiptId: { not: null } },
    orderBy: { id: "asc" }, take: 50_001, select: { leadId: true, marketingFormReceiptId: true },
  });
  let truncated = submissions.length > 50_000;
  if (truncated) submissions.pop();
  const leadByReceipt = new Map(submissions.flatMap((submission) => submission.leadId && submission.marketingFormReceiptId ? [[submission.marketingFormReceiptId, submission.leadId] as const] : []));
  const responses = leadByReceipt.size ? await database.marketingFormPartialResponse.findMany({
    where: { workspaceId, receiptId: { in: [...leadByReceipt.keys()] }, completedAt: { not: null }, deletedAt: null },
    orderBy: [{ firstAnsweredAt: "asc" }, { id: "asc" }], take: 50_001, select: { receiptId: true, firstAnsweredAt: true },
  }) : [];
  if (responses.length > 50_000) { responses.pop(); truncated = true; }
  for (const response of responses) {
    const leadId = response.receiptId && leadByReceipt.get(response.receiptId);
    if (leadId && response.firstAnsweredAt < dates.get(leadId)!) dates.set(leadId, response.firstAnsweredAt);
  }
  return { dates, truncated };
}
