import { createHash } from "node:crypto";
import type {
  CommercialMetricEventType,
  CommercialMetricExecutionMode,
  Prisma,
} from "@/generated/prisma/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const COMMERCIAL_METRIC_PRODUCER_VERSION = "indicators.v1";

export type CommercialMetricFactInput = Readonly<{
  workspaceId: string;
  eventKey: string;
  eventType: CommercialMetricEventType;
  occurredAt: Date;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceRevision?: number;
  leadId?: string | null;
  contactId?: string | null;
  accountId?: string | null;
  taskId?: string | null;
  activityId?: string | null;
  messageId?: string | null;
  phoneCallId?: string | null;
  meetingId?: string | null;
  opportunityId?: string | null;
  contractId?: string | null;
  paymentId?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  fromStageId?: string | null;
  toStageId?: string | null;
  teamId?: string | null;
  creditedMemberId?: string | null;
  performedByMemberId?: string | null;
  leadOwnerMemberIdAtEvent?: string | null;
  meetingOwnerMemberIdAtEvent?: string | null;
  opportunityOwnerMemberIdAtEvent?: string | null;
  bookedByMemberId?: string | null;
  originatingSdrMemberId?: string | null;
  sourceId?: string | null;
  campaignId?: string | null;
  creativeId?: string | null;
  politicalRole?: string | null;
  municipality?: string | null;
  stateCode?: string | null;
  channel?: string | null;
  direction?: string | null;
  taskKind?: string | null;
  activityType?: string | null;
  result?: string | null;
  cadenceInstanceId?: string | null;
  cadenceStepKey?: string | null;
  cadenceDay?: number | null;
  executionMode?: CommercialMetricExecutionMode;
  valueCents?: bigint | null;
  durationSeconds?: number | null;
  quantity?: number;
  correctionOfFactId?: string | null;
  reversedAt?: Date | null;
  reversalReason?: string | null;
  definitionVersion?: number;
  safeMetadata?: Prisma.InputJsonValue;
}>;

function stable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function commercialMetricFactFingerprint(input: CommercialMetricFactInput): string {
  return createHash("sha256").update(JSON.stringify(stable({ ...input, producerVersion: COMMERCIAL_METRIC_PRODUCER_VERSION }))).digest("hex");
}

export async function recordCommercialMetricFactInTransaction(
  transaction: Pick<Prisma.TransactionClient, "commercialMetricFact"> & Partial<Pick<Prisma.TransactionClient, "stageHistory">>,
  input: CommercialMetricFactInput,
) {
  const inputFingerprint = commercialMetricFactFingerprint(input);
  // pipelineId may identify the opportunity pipeline. Keep the commercial front
  // separately, from the lead's interval at the event, without changing replay hashes.
  const interval = !input.correctionOfFactId && input.leadId && transaction.stageHistory ? await transaction.stageHistory.findFirst({
    where: { workspaceId: input.workspaceId, leadId: input.leadId, opportunityId: null, pipeline: { entityType: "LEAD" }, enteredAt: { lte: input.occurredAt },
      OR: [{ exitedAt: null }, { exitedAt: { gt: input.occurredAt } }] },
    orderBy: [{ enteredAt: "desc" }, { id: "desc" }], select: { pipelineId: true },
  }) : null;
  const metadata = input.safeMetadata && typeof input.safeMetadata === "object" && !Array.isArray(input.safeMetadata) ? input.safeMetadata : {};
  const created = await transaction.commercialMetricFact.createMany({
    data: [{
      ...input,
      ...(interval ? { safeMetadata: { ...metadata, _commercialFrontPipelineId: interval.pipelineId } } : {}),
      sourceRevision: input.sourceRevision ?? 1,
      executionMode: input.executionMode ?? "SYSTEM",
      quantity: input.quantity ?? 1,
      definitionVersion: input.definitionVersion ?? 1,
      producerVersion: COMMERCIAL_METRIC_PRODUCER_VERSION,
      inputFingerprint,
    }],
    skipDuplicates: true,
  });
  const fact = await transaction.commercialMetricFact.findUniqueOrThrow({
    where: { workspaceId_eventKey: { workspaceId: input.workspaceId, eventKey: input.eventKey } },
  });
  if (fact.inputFingerprint !== inputFingerprint) {
    throw new ApplicationError("A chave do fato analítico já existe com conteúdo diferente.", {
      code: "COMMERCIAL_METRIC_FACT_CONFLICT",
      statusCode: 409,
      expose: true,
    });
  }
  return Object.freeze({ fact, idempotent: created.count === 0 });
}

export async function recordCommercialMetricCorrectionInTransaction(
  transaction: Pick<Prisma.TransactionClient, "commercialMetricFact">,
  input: CommercialMetricFactInput & Readonly<{ correctionOfFactId: string; reversalReason: string }>,
) {
  const original = await transaction.commercialMetricFact.findFirst({
    where: { id: input.correctionOfFactId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!original) {
    throw new ApplicationError("O fato original da correção não existe neste workspace.", {
      code: "COMMERCIAL_METRIC_CORRECTION_SOURCE_NOT_FOUND",
      statusCode: 404,
      expose: true,
    });
  }
  return recordCommercialMetricFactInTransaction(transaction, input);
}
