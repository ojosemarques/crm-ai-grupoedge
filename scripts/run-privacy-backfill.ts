import "dotenv/config";

import { randomUUID } from "node:crypto";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createPrivacyBackfillService } from "@/modules/privacy/application/privacy-backfill-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o backfill de privacidade.");
if (process.env.NODE_ENV === "production") throw new Error("Backfill local bloqueado com NODE_ENV=production.");
const parsedUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) throw new Error("O backfill CRM-36 só pode operar no PostgreSQL local conhecido.");
if (decodeURIComponent(parsedUrl.pathname.replace(/^\//, "")) !== "politizai_crm") throw new Error("O backfill CRM-36 só pode operar no banco local politizai_crm.");
if ((parsedUrl.searchParams.get("schema") ?? "public") !== "public") throw new Error("Este comando administrativo exige o schema public local.");
const mode = process.argv.find((argument) => argument.startsWith("--mode="))?.split("=")[1] ?? "dry-run";
if (mode !== "dry-run" && mode !== "execute") throw new Error("Use --mode=dry-run ou --mode=execute.");

const database = getDatabaseClient();
try {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE_SLUG } });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: DEMO_USERS[0].email }, status: "ACTIVE", deletedAt: null }, select: { id: true, userId: true, roleId: true, role: { select: { key: true, name: true } }, user: { select: { displayName: true } } } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: member.userId, type: "HUMAN" } });
  const context: AuthenticatedContext = { sessionId: randomUUID(), workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await createPrivacyBackfillService({ database, authorization: createAuthorizationService({ database }), now: () => new Date() }).run(context, { mode: mode === "execute" ? "EXECUTE" : "DRY_RUN", batchSize: 100 });
  process.stdout.write(`${JSON.stringify({ rule: "privacy-decision-v1", result })}\n`);
} finally {
  await database.$disconnect();
}
