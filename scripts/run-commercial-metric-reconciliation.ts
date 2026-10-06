import "dotenv/config";

import { getCommercialMetricReconciliationService } from "@/modules/metrics/application/commercial-metric-reconciliation-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para reconciliar métricas comerciais.");
const parsedUrl = new URL(databaseUrl);
const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(parsedUrl.hostname);
if (!isLocal && !process.argv.includes("--allow-production")) throw new Error("Banco remoto exige --allow-production explícito.");
const workspaceSlug = process.argv.find((value) => value.startsWith("--workspace="))?.slice(12);
if (!workspaceSlug) throw new Error("Informe --workspace=<slug>.");
const runKey = process.argv.find((value) => value.startsWith("--run-key="))?.slice(10) ?? `commercial-metrics:reconcile:${new Date().toISOString()}`;
const database = getDatabaseClient();

try {
  const member = await database.workspaceMember.findFirst({
    where: { workspace: { slug: workspaceSlug, status: "ACTIVE", deletedAt: null }, status: "ACTIVE", deletedAt: null, role: { key: "administrator" } },
    include: { workspace: true, role: true, user: { include: { actors: { where: { type: "HUMAN" }, orderBy: { createdAt: "asc" }, take: 1 } } } },
  });
  const actor = member?.user.actors[0];
  if (!member || !actor) throw new Error("Administrador ativo não encontrado no workspace informado.");
  const context = { workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, sessionId: "commercial-metrics-reconciliation-cli", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await getCommercialMetricReconciliationService().run(context, { runKey });
  process.stdout.write(`${JSON.stringify({ workspaceSlug, result }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.$disconnect();
}
