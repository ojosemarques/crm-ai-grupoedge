import type { Prisma } from "@/generated/prisma/client";
import { formCompletionTagNames, type FormCompletionStatus } from "@/modules/marketing-forms/domain/form-completion-status";

export const formCompletionTagSelection = {
  where: {
    removedAt: null,
    tag: { deletedAt: null, name: { in: Object.values(formCompletionTagNames), mode: "insensitive" } },
  },
  select: { tag: { select: { name: true } } },
} satisfies Prisma.LeadTagFindManyArgs;

export function resolveLeadFormCompletionTag(assignments: readonly { tag: { name: string } }[]) {
  const names = new Set(assignments.map(({ tag }) => tag.name.toLowerCase()));
  if (names.has(formCompletionTagNames.COMPLETED.toLowerCase())) return formCompletionTagNames.COMPLETED;
  if (names.has(formCompletionTagNames.PARTIAL.toLowerCase())) return formCompletionTagNames.PARTIAL;
  return null;
}

export async function assignLeadFormCompletionTag(
  tx: Prisma.TransactionClient,
  { workspaceId, actorId, leadId, status, now }: {
    workspaceId: string; actorId: string; leadId: string; status: FormCompletionStatus; now: Date;
  },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-form-completion:${workspaceId}:${leadId}`}, 0))`;
  const current = await tx.leadTag.findMany({
    where: { ...formCompletionTagSelection.where, workspaceId, leadId },
    select: formCompletionTagSelection.select,
  });
  const currentTag = resolveLeadFormCompletionTag(current);
  // A new partial response does not override a completion already recorded for this lead.
  if (status === "PARTIAL" && currentTag === formCompletionTagNames.COMPLETED) return;
  const name = formCompletionTagNames[status];
  if (currentTag !== name) {
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
      data: [{ workspaceId, leadId, tagId: tag.id, createdByActorId: actorId }],
      skipDuplicates: true,
    });
  }
  if (status === "COMPLETED" && current.some(({ tag }) => tag.name.toLowerCase() === formCompletionTagNames.PARTIAL.toLowerCase())) {
    await tx.leadTag.updateMany({
      where: { workspaceId, leadId, removedAt: null, tag: { deletedAt: null, name: { equals: formCompletionTagNames.PARTIAL, mode: "insensitive" } } },
      data: { removedAt: now, removedByActorId: actorId },
    });
  }
}
