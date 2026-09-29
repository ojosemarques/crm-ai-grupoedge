import "dotenv/config";

import { createContractBackfillService } from "@/modules/contracts/application/contract-backfill-service";
import { DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const database = getDatabaseClient();
const mode = process.argv.includes("--execute") ? "EXECUTE" : "DRY_RUN";
const runKeyArg = process.argv.find((value) => value.startsWith("--run-key="));
const runKey = runKeyArg?.slice("--run-key=".length) ?? `crm48:${mode.toLowerCase()}:manual`;
try {
  const member = await database.workspaceMember.findFirst({ where: { workspace: { slug: DEMO_WORKSPACE_SLUG, deletedAt: null }, status: "ACTIVE", deletedAt: null, role: { key: "administrator" } }, include: { workspace: true, role: true, user: { include: { actors: { where: { type: "HUMAN" }, take: 1 } } } } });
  const actor = member?.user.actors[0];
  if (!member || !actor) throw new Error("Administrador local não encontrado para executar o backfill.");
  const context = { workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, sessionId: "contract-backfill-cli", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await createContractBackfillService({ database, now: () => new Date() }).run(context, { mode, runKey });
  process.stdout.write(`${JSON.stringify({ mode, result }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally { await database.$disconnect(); }
