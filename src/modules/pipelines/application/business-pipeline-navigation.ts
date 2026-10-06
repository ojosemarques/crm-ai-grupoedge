import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { getDatabaseClient } from "@/shared/core/database/client";

export type BusinessPipelineOption = Readonly<{
  id: string;
  name: string;
  entityType: "LEAD" | "OPPORTUNITY";
  href: string;
}>;

export const ACTIVE_PROSPECTING_PIPELINE_NAME = "Prospecção Ativa";

export async function listBusinessPipelines(
  context: AuthenticatedContext,
): Promise<readonly BusinessPipelineOption[]> {
  const authorization = getAuthorizationService();
  const database = getDatabaseClient();
  const [pipelines, leadRead, opportunityRead] = await Promise.all([
    database.pipeline.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: [{ entityType: "asc" }, { isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, entityType: true },
    }),
    authorization.authorize(context, PermissionKeys.LEADS_READ, {
      workspaceId: context.workspaceId,
      resourceType: "LeadPipeline",
      memberId: context.memberId,
    }),
    authorization.authorize(context, PermissionKeys.OPPORTUNITIES_READ, {
      workspaceId: context.workspaceId,
      resourceType: "OpportunityPipeline",
      ownerMemberId: context.memberId,
    }),
  ]);
  return pipelines
    .filter((pipeline) => !(pipeline.entityType === "LEAD" && pipeline.name === ACTIVE_PROSPECTING_PIPELINE_NAME))
    .filter((pipeline) => pipeline.entityType === "LEAD" ? leadRead.allowed : opportunityRead.allowed)
    .map((pipeline) => ({
      ...pipeline,
      href: pipeline.entityType === "LEAD"
        ? `/pipeline?pipelineId=${pipeline.id}`
        : `/oportunidades?pipelineId=${pipeline.id}`,
    }));
}
