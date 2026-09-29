import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createLifecycleBackfillService } from "@/modules/lifecycle/application/lifecycle-backfill-service";
import { createLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";

export async function seedLifecycleDemoData(database: PrismaClient) {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE_SLUG } });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: DEMO_USERS[0].email }, status: "ACTIVE", deletedAt: null }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: member.userId, type: "HUMAN" } });
  const context: AuthenticatedContext = { sessionId: randomUUID(), workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const authorization = createAuthorizationService({ database });
  if (await database.revenueLifecycle.count({ where: { workspaceId: workspace.id } }) === 0) {
    await createLifecycleBackfillService({ database, authorization, now: () => new Date() }).run(context, { mode: "EXECUTE", batchSize: 100 });
  }
  const assignment = await database.ownershipAssignment.findFirst({ where: { workspaceId: workspace.id, entityType: "CONTACT", function: "SDR", status: "ACTIVE", memberId: { not: null } }, orderBy: [{ validFrom: "asc" }, { id: "asc" }] });
  if (!assignment?.contactId || !assignment.memberId) return { lifecycle: await database.revenueLifecycle.count({ where: { workspaceId: workspace.id } }), pendingTransfers: 0 };
  const destination = await database.workspaceMember.findFirst({ where: { workspaceId: workspace.id, id: { not: assignment.memberId }, status: "ACTIVE", deletedAt: null, teamMemberships: { some: { function: "SDR", deletedAt: null } } }, orderBy: { id: "asc" } });
  if (!destination) return { lifecycle: await database.revenueLifecycle.count({ where: { workspaceId: workspace.id } }), pendingTransfers: 0 };
  await createLifecycleService({ database, authorization, now: () => new Date() }).requestTransfer(context, { entityType: "CONTACT", entityId: assignment.contactId, fromFunction: "SDR", toFunction: "SDR", targetMemberId: destination.id, reason: "Cenário demonstrativo de transferência pendente entre SDRs.", nextActionDescription: "Revisar contexto e aceitar ou rejeitar a carteira.", idempotencyKey: "seed:lifecycle:pending-transfer:v1" });
  return { lifecycle: await database.revenueLifecycle.count({ where: { workspaceId: workspace.id } }), pendingTransfers: await database.ownershipTransfer.count({ where: { workspaceId: workspace.id, status: "REQUESTED" } }) };
}
