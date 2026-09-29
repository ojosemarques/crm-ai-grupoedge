import "dotenv/config";
import { createRevenueBackfillService } from "@/modules/revenue/application/revenue-backfill-service";
import { DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const database = getDatabaseClient();
const mode = process.argv.includes("--execute") ? "EXECUTE" : "DRY_RUN";
try {
  const member = await database.workspaceMember.findFirst({ where: { workspace: { slug: DEMO_WORKSPACE_SLUG, deletedAt: null }, status: "ACTIVE", deletedAt: null, role: { key: "administrator" } }, include: { workspace: true, role: true, user: { include: { actors: { where: { type: "HUMAN" }, take: 1 } } } } });
  const actor = member?.user.actors[0];
  if (!member || !actor) throw new Error("Administrador local não encontrado para executar o backfill.");
  const context = { workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, sessionId: "revenue-backfill-cli", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await createRevenueBackfillService(database).run(context, { mode, idempotencyKey: `revenue-backfill-${mode.toLowerCase()}-v1` });
  process.stdout.write(`${JSON.stringify({ mode, result }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.$disconnect();
}
