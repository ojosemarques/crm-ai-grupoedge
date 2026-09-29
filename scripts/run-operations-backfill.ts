import "dotenv/config";

import { randomUUID } from "node:crypto";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOperationsBackfillService } from "@/modules/operations/application/operations-backfill-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o backfill CRM-62.");
if (process.env.NODE_ENV === "production") throw new Error("Backfill CRM-62 bloqueado com NODE_ENV=production.");
const parsed = new URL(databaseUrl);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) throw new Error("Backfill CRM-62 permitido somente no PostgreSQL local conhecido.");
if (decodeURIComponent(parsed.pathname.slice(1)) !== "politizai_crm" || (parsed.searchParams.get("schema") ?? "public") !== "public") throw new Error("Backfill CRM-62 permitido somente em politizai_crm/public local.");
const execute = process.argv.includes("--execute");
const database = getDatabaseClient();

try {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspace: { slug: DEMO_WORKSPACE_SLUG, deletedAt: null }, user: { normalizedEmail: DEMO_USERS[0].email }, status: "ACTIVE", deletedAt: null },
    include: { workspace: true, role: true, user: true },
  });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  const context: AuthenticatedContext = { sessionId: randomUUID(), workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await createOperationsBackfillService({ database, authorization: createAuthorizationService({ database }), now: () => new Date() }).run(context, { mode: execute ? "EXECUTE" : "DRY_RUN", batchSize: 100 });
  process.stdout.write(`${JSON.stringify({ task: "CRM-62", ...result })}\n`);
} finally {
  await database.$disconnect();
}
