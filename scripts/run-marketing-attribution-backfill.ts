import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o backfill de atribuição.");
if (process.env.NODE_ENV === "production") throw new Error("Backfill CRM-38 bloqueado em produção.");
const parsedUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) throw new Error("O backfill CRM-38 só pode operar no PostgreSQL local conhecido.");
if (decodeURIComponent(parsedUrl.pathname.replace(/^\//, "")) !== "politizai_crm") throw new Error("O backfill CRM-38 só pode operar no banco local politizai_crm.");
if ((parsedUrl.searchParams.get("schema") ?? "public") !== "public") throw new Error("Este comando administrativo exige o schema public local.");
const mode = process.argv.find((argument) => argument.startsWith("--mode="))?.split("=")[1] ?? "dry-run";
if (mode !== "dry-run" && mode !== "execute") throw new Error("Use --mode=dry-run ou --mode=execute.");
const limit = Number(process.argv.find((argument) => argument.startsWith("--limit="))?.split("=")[1] ?? "2000");
if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("Use --limit entre 1 e 10000.");

const database = getDatabaseClient();
try {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE_SLUG } });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: DEMO_USERS[0].email }, status: "ACTIVE", deletedAt: null }, select: { id: true, userId: true, roleId: true, role: { select: { key: true, name: true } }, user: { select: { displayName: true } } } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: member.userId, type: "HUMAN" } });
  const context: AuthenticatedContext = { sessionId: randomUUID(), workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await createMarketingAttributionService({ database, now: () => new Date() }).backfill(context, { mode: mode === "execute" ? "EXECUTE" : "DRY_RUN", limit, idempotencyKey: `crm38-${mode}-${new Date().toISOString().slice(0, 10)}-${limit}` });
  process.stdout.write(`${JSON.stringify({ ruleVersion: "crm38-backfill-v1", result }, (_, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.$disconnect();
}
