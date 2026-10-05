import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { ensureActiveProspectingPipeline } from "@/modules/settings/application/production-foundation-service";
import { getDatabaseClient } from "@/shared/core/database/client";

export type BusinessPipelineOption = Readonly<{
  id: string;
  name: string;
  entityType: "PROSPECTING" | "LEAD" | "OPPORTUNITY";
  href: string;
}>;

export const ACTIVE_PROSPECTING_PIPELINE_NAME = "Prospecção Ativa";

export async function listBusinessPipelines(
  context: AuthenticatedContext,
): Promise<readonly BusinessPipelineOption[]> {
  const authorization = getAuthorizationService();
  const database = getDatabaseClient();
  const [initialPipelines, leadRead, opportunityRead] = await Promise.all([
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
  let pipelines = initialPipelines;
  if (leadRead.allowed && !pipelines.some((pipeline) =>
    pipeline.entityType === "LEAD" && pipeline.name === ACTIVE_PROSPECTING_PIPELINE_NAME
  )) {
    await ensureActiveProspectingPipeline(database, context.workspaceId, context.actorId);
    pipelines = await database.pipeline.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: [{ entityType: "asc" }, { isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, entityType: true },
    });
  }

  const configuredPipelines: BusinessPipelineOption[] = pipelines
    .filter((pipeline) => pipeline.entityType === "LEAD" ? leadRead.allowed : opportunityRead.allowed)
    .map((pipeline) => {
      const isActiveProspecting = pipeline.entityType === "LEAD"
        && pipeline.name === ACTIVE_PROSPECTING_PIPELINE_NAME;
      return {
        ...pipeline,
        entityType: isActiveProspecting ? "PROSPECTING" as const : pipeline.entityType,
        href: isActiveProspecting
          ? "/email-agente"
          : pipeline.entityType === "LEAD"
            ? `/pipeline?pipelineId=${pipeline.id}`
            : `/oportunidades?pipelineId=${pipeline.id}`,
      };
    });

  return configuredPipelines.sort((left, right) =>
    Number(right.entityType === "PROSPECTING") - Number(left.entityType === "PROSPECTING"),
  );
}
