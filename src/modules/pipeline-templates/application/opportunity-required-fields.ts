import type { Prisma } from "@/generated/prisma/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

export async function assertPipelineRequiredFields(
  transaction: Prisma.TransactionClient,
  opportunityId: string,
  targetStageId: string,
): Promise<void> {
  const opportunity = await transaction.opportunity.findFirst({
    where: { id: opportunityId },
    include: {
      pipeline: { include: { templateApplication: { include: { templateVersion: { include: { stages: { include: { requiredFields: true } } } } } } } },
      offers: { where: { deletedAt: null }, select: { offerTemplateId: true } },
    },
  });
  if (!opportunity?.pipeline.templateApplication) return;
  const actual = await transaction.pipelineStage.findUniqueOrThrow({ where: { id: targetStageId } });
  const templateStage = opportunity.pipeline.templateApplication.templateVersion.stages.find((stage) => stage.position === actual.position);
  if (!templateStage) return;
  const offerIds = new Set(opportunity.offers.map((offer) => offer.offerTemplateId).filter(Boolean));
  const applicable = templateStage.requiredFields.filter((field) => !field.offerTemplateId || offerIds.has(field.offerTemplateId));
  const record = opportunity as unknown as Record<string, unknown>;
  const missing: string[] = [];
  for (const field of applicable) {
    if (field.fieldKey.startsWith("custom:")) {
      const key = field.fieldKey.slice(7);
      const value = await transaction.customFieldValue.findFirst({ where: { workspaceId: opportunity.workspaceId, entityType: "OPPORTUNITY", entityId: opportunity.id, definition: { key, active: true } }, select: { id: true } });
      if (!value) missing.push(field.label);
    } else if (record[field.fieldKey] === null || record[field.fieldKey] === undefined || record[field.fieldKey] === "") {
      missing.push(field.label);
    }
  }
  if (missing.length) throw new ApplicationError(`Preencha antes de avançar: ${missing.join(", ")}.`, { code: "REQUIRED_FIELDS_MISSING", statusCode: 400, expose: true });
}
