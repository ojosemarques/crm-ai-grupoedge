import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { getDatabaseClient } from "@/shared/core/database/client";

export type BusinessPipelineOption = Readonly<{
  id: string;
  name: string;
  entityType: "PROSPECTING" | "LEAD" | "OPPORTUNITY";
  href: string;
}>;

export const ACTIVE_PROSPECTING_PIPELINE_ID = "active-prospecting";

export async function listBusinessPipelines(
  context: AuthenticatedContext,
): Promise<readonly BusinessPipelineOption[]> {
  const authorization = getAuthorizationService();
  const [pipelines, inboxRead, leadRead, opportunityRead] = await Promise.all([
    getDatabaseClient().pipeline.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: [{ entityType: "asc" }, { isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, entityType: true },
    }),
    authorization.authorize(context, PermissionKeys.INBOX_READ, {
      workspaceId: context.workspaceId,
      resourceType: "Conversation",
      ownerMemberId: context.memberId,
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

  const configuredPipelines = pipelines
    .filter((pipeline) => pipeline.entityType === "LEAD" ? leadRead.allowed : opportunityRead.allowed)
    .map((pipeline) => ({
      ...pipeline,
      href: pipeline.entityType === "LEAD"
        ? `/pipeline?pipelineId=${pipeline.id}`
        : `/oportunidades?pipelineId=${pipeline.id}`,
    }));

  return inboxRead.allowed
    ? [{
        id: ACTIVE_PROSPECTING_PIPELINE_ID,
        name: "Prospecção Ativa",
        entityType: "PROSPECTING" as const,
        href: "/email-agente",
      }, ...configuredPipelines]
    : configuredPipelines;
}
