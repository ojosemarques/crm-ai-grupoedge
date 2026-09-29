import "dotenv/config";
import { createCustomerServiceBackfillService } from "@/modules/customer-service/application/customer-service-backfill-service";
import { DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o backfill CRM-53.");
const parsed = new URL(databaseUrl);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) || decodeURIComponent(parsed.pathname.slice(1)) !== "politizai_crm" || (parsed.searchParams.get("schema") ?? "public") !== "public") throw new Error("O backfill CRM-53 aceita apenas politizai_crm/public no PostgreSQL local.");
const database = getDatabaseClient(); const mode = process.argv.includes("--execute") ? "EXECUTE" : "DRY_RUN"; const runKey = process.argv.find((value) => value.startsWith("--run-key="))?.slice(10) ?? `crm53:${mode.toLowerCase()}:manual`;
try {
  const member = await database.workspaceMember.findFirst({ where: { workspace: { slug: DEMO_WORKSPACE_SLUG, deletedAt: null }, status: "ACTIVE", deletedAt: null, role: { key: "administrator" } }, include: { workspace: true, role: true, user: { include: { actors: { where: { type: "HUMAN" }, take: 1 } } } } }); const actor = member?.user.actors[0];
  if (!member || !actor) throw new Error("Administrador local não encontrado para executar o backfill CRM-53.");
  const context = { workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, sessionId: "customer-service-backfill-cli", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  process.stdout.write(`${JSON.stringify({ mode, result: await createCustomerServiceBackfillService({ database, authorization: getAuthorizationService(), now: () => new Date() }).run(context, { mode, runKey }) })}\n`);
} finally { await database.$disconnect(); }
