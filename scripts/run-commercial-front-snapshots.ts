import "dotenv/config";
import { getDatabaseClient } from "@/shared/core/database/client";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createCommercialFrontSnapshotService } from "@/modules/metrics/application/commercial-front-snapshot-service";

const url = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) && !process.argv.includes("--allow-production")) throw new Error("Banco remoto exige --allow-production.");
const slug = process.argv.find((argument) => argument.startsWith("--workspace="))?.slice(12);
if (!slug) throw new Error("Informe --workspace=<slug>.");
const expected = process.argv.find((argument) => argument.startsWith("--expected-count="))?.slice(17);
const asOf = process.argv.find((argument) => argument.startsWith("--as-of="))?.slice(8);
const database = getDatabaseClient();
try {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspace: { slug, status: "ACTIVE", deletedAt: null }, role: { key: "administrator" }, status: "ACTIVE", deletedAt: null }, include: { user: true, role: true, workspace: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  const result = await createCommercialFrontSnapshotService({ database, authorization: getAuthorizationService() }).run({ workspaceId: member.workspaceId, workspaceSlug: slug, memberId: member.id, userId: member.userId, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName, sessionId: "commercial-front-snapshot-cli" }, { mode: process.argv.includes("--apply") ? "APPLY" : "DRY_RUN", ...(asOf ? { recordedBefore: new Date(asOf) } : {}), ...(expected === undefined ? {} : { expectedCount: Number(expected) }) });
  console.log(JSON.stringify(result));
} finally { await database.$disconnect(); }
