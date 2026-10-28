import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { leadVisibilityWhere, resolveLeadVisibilityScope } from "@/modules/leads/application/lead-list-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

export function createRelatedCommercialHistoryService(options: Readonly<{
  database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>;
}>) {
  async function getHistory(context: AuthenticatedContext, leadId: string) {
    const scope = await resolveLeadVisibilityScope(options.database, options.authorization, context, PermissionKeys.LEADS_READ);
    const visibility = leadVisibilityWhere(context, scope);
    const current = await options.database.lead.findFirst({
      where: { id: leadId, workspaceId: context.workspaceId, deletedAt: null, AND: [visibility] },
      select: { contactId: true, normalizedPhone: true, normalizedEmail: true, needsIdentityReview: true, contact: { select: { quality: true } } },
    });
    if (!current) return [];
    const matches = [
      ...(current.contactId ? [{ contactId: current.contactId }] : []),
      ...(current.normalizedPhone ? [{ normalizedPhone: current.normalizedPhone }] : []),
      ...(current.normalizedEmail ? [{ normalizedEmail: current.normalizedEmail }] : []),
    ];
    if (!matches.length) return [];
    const rows = await options.database.lead.findMany({
      where: { workspaceId: context.workspaceId, id: { not: leadId }, deletedAt: null, AND: [visibility, { OR: matches }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 11,
      select: { id: true, contactId: true, needsIdentityReview: true, createdAt: true, pipeline: { select: { name: true } }, currentStage: { select: { name: true } }, source: { select: { name: true } }, owner: { select: { user: { select: { displayName: true } } } } },
    });
    return rows.map((row) => ({ ...row, confirmed: Boolean(current.contactId && row.contactId === current.contactId && current.contact?.quality === "CONFIRMED" && !current.needsIdentityReview && !row.needsIdentityReview), createdAt: row.createdAt.toISOString() }));
  }
  return { getHistory };
}
export function getRelatedCommercialHistoryService() {
  return createRelatedCommercialHistoryService({ database: getDatabaseClient(), authorization: getAuthorizationService() });
}
