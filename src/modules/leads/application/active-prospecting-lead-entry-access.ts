import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";

export const ACTIVE_PROSPECTING_PIPELINE_NAME = "Prospecção Ativa";

export async function getActiveProspectingLeadEntryPipeline(
  database: PrismaClient,
  context: AuthenticatedContext,
  pipelineId?: string,
) {
  const [sellerConfig, member, pipeline] = await Promise.all([
    database.prospectingSellerConfig.findFirst({
      where: {
        workspaceId: context.workspaceId,
        memberId: context.memberId,
        active: true,
      },
      select: { id: true },
    }),
    database.workspaceMember.findFirst({
      where: {
        ...commercialMemberWhere({
          workspaceId: context.workspaceId,
          memberId: context.memberId,
          functions: ["SDR", "CLOSER"],
        }),
        userId: context.userId,
      },
      select: { id: true },
    }),
    database.pipeline.findFirst({
      where: {
        workspaceId: context.workspaceId,
        entityType: "LEAD",
        name: ACTIVE_PROSPECTING_PIPELINE_NAME,
        ...(pipelineId ? { id: pipelineId } : {}),
        deletedAt: null,
        stages: { some: { type: "OPEN", deletedAt: null } },
      },
      select: { id: true, name: true, isDefault: true },
    }),
  ]);

  return sellerConfig && member ? pipeline : null;
}
