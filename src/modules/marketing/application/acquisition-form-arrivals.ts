import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { marketingFormDefinitionSchema } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import type { FunnelLead } from "../domain/acquisition-funnel";
import { excludedMetricLeadIds } from "@/modules/metrics/application/metric-lead-exclusions";

const destinationSchema = z.object({ destination: marketingFormDefinitionSchema.shape.destination });

/** Only aggregate attribution fields are read; respondent identities stay in Forms. */
export async function loadAcquisitionFormArrivals(database: Prisma.TransactionClient, workspaceId: string, start: Date, end: Date, pipelineName?: string) {
  const excludedIds = await excludedMetricLeadIds(database, workspaceId);
  const excludedSubmissions = excludedIds.length ? await database.leadFormSubmission.findMany({
    where: { workspaceId, leadId: { in: excludedIds } }, select: { idempotencyKey: true, marketingFormReceiptId: true },
  }) : [];
  const excludedPartialIds = excludedSubmissions.flatMap((submission) => /^marketing-form-partial-lead:[0-9a-f-]{36}$/.test(submission.idempotencyKey) ? [submission.idempotencyKey.slice("marketing-form-partial-lead:".length)] : []);
  const excludedReceiptIds = excludedSubmissions.flatMap((submission) => submission.marketingFormReceiptId ? [submission.marketingFormReceiptId] : []);
  const responses = await database.marketingFormPartialResponse.findMany({
    where: { workspaceId, deletedAt: null, firstAnsweredAt: { gte: start, lt: end }, id: { notIn: excludedPartialIds }, OR: [{ receiptId: null }, { receiptId: { notIn: excludedReceiptIds } }] },
    orderBy: [{ firstAnsweredAt: "asc" }, { id: "asc" }], take: 10_001,
    select: { id: true, marketingFormId: true, marketingFormVersionId: true, completedAt: true, receiptId: true, utmCampaign: true, utmContent: true },
  });
  const truncated = responses.length > 10_000;
  if (truncated) responses.pop();
  const pending = responses.filter((response) => !response.completedAt);
  const promoted = pending.length ? await database.leadFormSubmission.findMany({
    where: { workspaceId, idempotencyKey: { in: pending.map((response) => `marketing-form-partial-lead:${response.id}`) }, lead: { deletedAt: null, ...(pipelineName ? { pipeline: { name: pipelineName, deletedAt: null } } : {}) } },
    select: { idempotencyKey: true, leadId: true },
  }) : [];
  const promotedKeys = new Set(promoted.map((submission) => submission.idempotencyKey));
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
    if (promotedKeys.has(`marketing-form-partial-lead:${response.id}`)) return [];
    const destination = destinations.get(response.marketingFormVersionId);
    if (!activeForms.has(response.marketingFormId) || !destination || !allowedPipelines.has(destination.pipelineId)) return [];
    return [{ id: `partial:${response.id}`, source: sourceByKey.get(destination.sourceKey) ?? null, campaign: null, creative: null, utmCampaign: response.utmCampaign, utmContent: response.utmContent, tags: [], meetings: [], wins: [] }];
  });
  return { incomplete, excludedLeadIds: excludedIds, promotedIncompleteLeadIds: promoted.flatMap((submission) => submission.leadId ? [submission.leadId] : []), completedReceiptIds: responses.flatMap((response) => response.completedAt && response.receiptId ? [response.receiptId] : []), truncated };
}

/** Completion replaces the partial entry while retaining its first arrival day. */
export async function loadLeadArrivalDates(database: Prisma.TransactionClient, workspaceId: string, leads: readonly { id: string; createdAt: Date }[]) {
  const dates = new Map(leads.map((lead) => [lead.id, lead.createdAt]));
  if (!leads.length) return { dates, truncated: false };
  const submissions = await database.leadFormSubmission.findMany({
    where: { workspaceId, leadId: { in: leads.map((lead) => lead.id) }, OR: [{ marketingFormReceiptId: { not: null } }, { idempotencyKey: { startsWith: "marketing-form-partial-lead:" } }] },
    orderBy: { id: "asc" }, take: 50_001, select: { leadId: true, marketingFormReceiptId: true, idempotencyKey: true },
  });
  let truncated = submissions.length > 50_000;
  if (truncated) submissions.pop();
  const leadByReceipt = new Map(submissions.flatMap((submission) => submission.leadId && submission.marketingFormReceiptId ? [[submission.marketingFormReceiptId, submission.leadId] as const] : []));
  const leadByPartial = new Map(submissions.flatMap((submission) => submission.leadId && /^marketing-form-partial-lead:[0-9a-f-]{36}$/.test(submission.idempotencyKey) ? [[submission.idempotencyKey.slice("marketing-form-partial-lead:".length), submission.leadId] as const] : []));
  const responses = leadByReceipt.size || leadByPartial.size ? await database.marketingFormPartialResponse.findMany({
    where: { workspaceId, deletedAt: null, OR: [{ receiptId: { in: [...leadByReceipt.keys()] }, completedAt: { not: null } }, { id: { in: [...leadByPartial.keys()] } }] },
    orderBy: [{ firstAnsweredAt: "asc" }, { id: "asc" }], take: 50_001, select: { id: true, receiptId: true, firstAnsweredAt: true },
  }) : [];
  if (responses.length > 50_000) { responses.pop(); truncated = true; }
  for (const response of responses) {
    const leadId = leadByPartial.get(response.id) ?? (response.receiptId && leadByReceipt.get(response.receiptId));
    if (leadId && response.firstAnsweredAt < dates.get(leadId)!) dates.set(leadId, response.firstAnsweredAt);
  }
  return { dates, truncated };
}
