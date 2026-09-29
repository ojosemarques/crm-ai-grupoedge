import "dotenv/config";

import { createFarmerBackfillService } from "@/modules/farmer/application/farmer-backfill-service";
import { DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o backfill CRM-54.");
const parsed = new URL(databaseUrl);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)
  || decodeURIComponent(parsed.pathname.slice(1)) !== "politizai_crm"
  || (parsed.searchParams.get("schema") ?? "public") !== "public") {
  throw new Error("Backfill Farmer permitido somente em politizai_crm/public local.");
}

const mode = process.argv.includes("--execute") ? "EXECUTE" : "DRY_RUN";
const runKey = process.argv.find((value) => value.startsWith("--run-key="))?.slice(10)
  ?? process.env.FARMER_BACKFILL_RUN_KEY
  ?? `crm54:${mode.toLowerCase()}:manual`;
const database = getDatabaseClient();

try {
  const member = await database.workspaceMember.findFirst({
    where: { workspace: { slug: DEMO_WORKSPACE_SLUG, deletedAt: null }, status: "ACTIVE", deletedAt: null, role: { key: "administrator" } },
    include: { workspace: true, role: true, user: { include: { actors: { where: { type: "HUMAN" }, take: 1 } } } },
  });
  const actor = member?.user.actors[0];
  if (!member || !actor) throw new Error("Administrador local não encontrado para o backfill CRM-54.");
  const context = {
    workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, sessionId: "farmer-backfill-cli",
    userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId,
    roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName,
  };
  const result = await createFarmerBackfillService({ database, authorization: getAuthorizationService(), now: () => new Date() }).run(context, { mode, runKey });
  process.stdout.write(`${JSON.stringify({ mode, result }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.$disconnect();
}
