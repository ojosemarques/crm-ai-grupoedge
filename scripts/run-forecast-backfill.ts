import "dotenv/config";
import { getForecastBackfillService } from "@/modules/forecast/application/forecast-backfill-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname) || databaseUrl.pathname !== "/politizai_crm" || (databaseUrl.searchParams.get("schema") ?? "public") !== "public") throw new Error("Backfill CRM-56 opera somente em politizai_crm/public local.");
const execute = process.argv.includes("--execute");
const runKey = process.argv.find((argument) => argument.startsWith("--run-key="))?.slice("--run-key=".length) ?? `crm56:forecast:${execute ? "execute" : "dry"}:${new Date().toISOString()}`;
const database = getDatabaseClient();
try {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, role: { key: "administrator" }, status: "ACTIVE", deletedAt: null }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: member.userId, type: "HUMAN" } });
  const context = { workspaceId: workspace.id, workspaceSlug: workspace.slug, sessionId: "forecast-backfill-cli", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await getForecastBackfillService().run(context, { mode: execute ? "EXECUTE" : "DRY_RUN", runKey });
  process.stdout.write(`${JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally { await database.$disconnect(); }
