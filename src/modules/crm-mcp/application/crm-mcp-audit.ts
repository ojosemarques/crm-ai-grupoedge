import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { sanitizeAuditValue } from "@/modules/audit/application/audit-administration-service";
import { auditQuerySchema } from "@/modules/audit/domain/audit-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

// The administrative screen also runs live diagnostics across all CRM records.
// Machine audit reads use the same permission and sanitizer, with bounded reads
// of persisted events/findings rather than an interactive diagnostic transaction.
export async function readCrmMcpAudit(context: AuthenticatedContext, input: unknown) {
  await getAuthorizationService().assertAuthorized(context, PermissionKeys.AUDIT_READ, { workspaceId: context.workspaceId, resourceType: "AuditLog", resourceId: context.workspaceId });
  const query = auditQuerySchema.parse(input);
  const database = getDatabaseClient();
  const auditWhere: Prisma.AuditLogWhereInput = {
    workspaceId: context.workspaceId,
    ...(query.auditActorType ? { actor: { type: query.auditActorType } } : {}),
    ...(query.auditActorId ? { actorId: query.auditActorId } : {}),
    ...(query.auditOrigin ? { origin: query.auditOrigin } : {}),
    ...(query.auditAction ? { action: query.auditAction } : {}),
    ...(query.auditEntityType ? { entityType: query.auditEntityType } : {}),
    ...(query.auditFrom && query.auditTo ? { occurredAt: { gte: new Date(query.auditFrom), lt: new Date(query.auditTo) } } : {}),
    ...(query.auditSearch ? { OR: [
      { action: { contains: query.auditSearch, mode: "insensitive" } },
      { entityType: { contains: query.auditSearch, mode: "insensitive" } },
      { requestId: { contains: query.auditSearch, mode: "insensitive" } },
      { actor: { displayName: { contains: query.auditSearch, mode: "insensitive" } } },
    ] } : {}),
  };
  const violationWhere: Prisma.ProcessViolationWhereInput = {
    workspaceId: context.workspaceId,
    ...(query.violationType ? { type: query.violationType } : {}),
    ...(query.violationSeverity ? { severity: query.violationSeverity } : {}),
    ...(query.violationStatus ? { status: query.violationStatus } : {}),
  };
  const [auditTotal, auditRows, violationTotal, violationRows] = await Promise.all([
    database.auditLog.count({ where: auditWhere }),
    database.auditLog.findMany({ where: auditWhere, skip: (query.auditPage - 1) * 25, take: 25,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { id: true, action: true, entityType: true, entityId: true, origin: true, reason: true, occurredAt: true, requestId: true, changes: true, metadata: true, actor: { select: { id: true, type: true, displayName: true } } },
    }),
    database.processViolation.count({ where: violationWhere }),
    database.processViolation.findMany({ where: violationWhere, skip: (query.violationPage - 1) * 25, take: 25,
      orderBy: [{ severity: "desc" }, { detectedAt: "desc" }, { id: "desc" }],
      select: { id: true, type: true, severity: true, status: true, title: true, evidenceSummary: true, detectedAt: true, leadId: true, meetingId: true, opportunityId: true },
    }),
  ]);
  return {
    audit: { total: auditTotal, page: query.auditPage, pageSize: 25, items: auditRows.map(({ changes, metadata, reason, ...row }) => ({ ...row, reason: sanitizeAuditValue(reason), changes: sanitizeAuditValue(changes), metadata: sanitizeAuditValue(metadata) })) },
    violations: { total: violationTotal, page: query.violationPage, pageSize: 25, items: violationRows.map(({ title, evidenceSummary, ...row }) => ({ ...row, title: sanitizeAuditValue(title), evidenceSummary: sanitizeAuditValue(evidenceSummary) })) },
    coverage: "Persisted audit events and process findings. No live health scan is performed; page reads are independent snapshots.",
  };
}
