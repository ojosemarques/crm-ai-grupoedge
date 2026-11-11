import type { Prisma } from "@/generated/prisma/client";
import { formBudgetTags, type FormBudgetObservation } from "@/modules/marketing-forms/domain/form-budget-response";

export const FORM_BUDGET_TAG_OBSERVED = "lead.form_budget_observed";

export function resolveLeadFormBudgetTag(assignments: readonly { tag: { name: string } }[]) {
  return formBudgetTags.find((name) => assignments.some(({ tag }) => tag.name.toUpperCase() === name)) ?? null;
}

export async function assignLeadFormBudgetTag(
  tx: Prisma.TransactionClient,
  { workspaceId, actorId, leadId, observation }: {
    workspaceId: string; actorId: string; leadId: string; observation: FormBudgetObservation | null;
  },
) {
  if (!observation) return;
  const { tag: name, observedAt, finalized } = observation;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-form-budget:${workspaceId}:${leadId}`}, 0))`;
  const previous = await tx.auditLog.findFirst({
    where: { workspaceId, entityType: "Lead", entityId: leadId, action: FORM_BUDGET_TAG_OBSERVED },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { occurredAt: true, changes: true },
  });
  const previousChanges = previous?.changes as { tag?: string; finalized?: boolean } | null;
  if (previous && previous.occurredAt > observedAt) return;
  if (previous && previous.occurredAt.getTime() === observedAt.getTime()
    && previousChanges?.finalized && !finalized) return;

  const where = { workspaceId, name: { equals: name, mode: "insensitive" as const }, deletedAt: null };
  const existing = await tx.tag.findFirst({ where, select: { id: true } });
  if (!existing) {
    await tx.tag.createMany({
      data: [{ workspaceId, name, createdByActorId: actorId, updatedByActorId: actorId }],
      skipDuplicates: true,
    });
  }
  const tag = existing ?? await tx.tag.findFirstOrThrow({ where, select: { id: true } });
  await tx.leadTag.createMany({
    data: [{ workspaceId, leadId, tagId: tag.id, createdByActorId: actorId }], skipDuplicates: true,
  });
  await tx.leadTag.updateMany({
    where: {
      workspaceId, leadId, removedAt: null, tagId: { not: tag.id },
      tag: { deletedAt: null, name: { in: [...formBudgetTags], mode: "insensitive" } },
    },
    data: { removedAt: new Date(), removedByActorId: actorId },
  });
  if (previous?.occurredAt.getTime() === observedAt.getTime()
    && previousChanges?.tag === name && previousChanges.finalized === finalized) return;
  await tx.auditLog.create({
    data: {
      workspaceId, actorId, entityType: "Lead", entityId: leadId,
      action: FORM_BUDGET_TAG_OBSERVED, origin: "SYSTEM", occurredAt: observedAt, changes: { tag: name, finalized },
    },
  });
}
