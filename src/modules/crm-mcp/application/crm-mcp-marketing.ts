import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { workspaceDayRange } from "@/shared/core/time/workspace-time";

export async function resolveMarketingDays(context: AuthenticatedContext, input: { periodStart: string; periodEnd: string }) {
  const { timeZone } = await getDatabaseClient().workspace.findUniqueOrThrow({
    where: { id: context.workspaceId }, select: { timeZone: true },
  });
  return {
    periodStart: workspaceDayRange(input.periodStart, timeZone).start,
    periodEnd: workspaceDayRange(input.periodEnd, timeZone).end,
  };
}

export function authorizeMarketingFormDefinition(context: AuthenticatedContext, formId?: string) {
  return getAuthorizationService().assertAuthorized(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE, {
    workspaceId: context.workspaceId, resourceType: "MarketingForm",
    ...(formId ? { resourceId: formId } : {}),
  });
}

export async function readCrmMcpAttribution(context: AuthenticatedContext, input: Record<string, unknown>) {
  const { definitions, runs, issues, permissions, ...screen } = await getMarketingAttributionService().getScreen(context, input);
  return {
    ...screen,
    definitions: {
      landingPages: definitions.landingPages.map(({ id, key, name, canonicalUrl, status, currentVersion }) => ({ id, key, name, canonicalUrl, status, currentVersion })),
      forms: definitions.forms.map(({ id, name, publicSlug, status, currentVersion }) => ({ id, name, publicSlug, status, currentVersion })),
    },
    runs: runs.map(({ id, attributionModelId, modelVersionId, status, periodStart, periodEnd, startedAt, finishedAt, conversionCount, attributedCount, partialCount, unattributedCount, coverageBps, divergenceCount, errorCode }) => ({
      id, attributionModelId, modelVersionId, status, periodStart, periodEnd, startedAt, finishedAt,
      conversionCount, attributedCount, partialCount, unattributedCount, coverageBps, divergenceCount, errorCode,
    })),
    issues: issues.map(({ id, entityType, entityId, issueCode, severity, status, detectedAt, acknowledgedAt, resolvedAt }) => ({
      id, entityType, entityId, issueCode, severity, status, detectedAt, acknowledgedAt, resolvedAt,
    })),
    evidenceExportAllowed: permissions.canExportEvidence,
  };
}
