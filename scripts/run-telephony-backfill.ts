import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createTelephonyBackfillService } from "@/modules/integrations/application/telephony-backfill-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o backfill CRM-46.");
if (process.env.NODE_ENV === "production") throw new Error("Backfill CRM-46 bloqueado com NODE_ENV=production.");
const parsed = new URL(databaseUrl);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) || decodeURIComponent(parsed.pathname.slice(1)) !== "politizai_crm" || (parsed.searchParams.get("schema") ?? "public") !== "public") throw new Error("O backfill CRM-46 aceita apenas politizai_crm/public no PostgreSQL local.");
const mode = process.argv.includes("--execute") ? "EXECUTE" : "DRY_RUN";
const runKeyArgument = process.argv.find((argument) => argument.startsWith("--run-key="));
const runKey = runKeyArgument?.slice("--run-key=".length) ?? `crm46-${mode.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;
const database = new PrismaClient({ adapter: createPostgresAdapter(databaseUrl) });

try {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE_SLUG } });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: DEMO_USERS[0].email }, status: "ACTIVE", deletedAt: null }, select: { id: true, userId: true, roleId: true, role: { select: { key: true, name: true } }, user: { select: { displayName: true } } } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: member.userId, type: "HUMAN" } });
  const context: AuthenticatedContext = { sessionId: randomUUID(), workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await createTelephonyBackfillService({ database, authorization: createAuthorizationService({ database }), now: () => new Date() }).run(context, { mode, runKey });
  process.stdout.write(`${JSON.stringify({ ruleVersion: "crm46-telephony-facts-v1", result }, (_, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally { await database.$disconnect(); }
