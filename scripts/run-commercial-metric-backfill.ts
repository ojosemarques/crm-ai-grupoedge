import "dotenv/config";

import { getCommercialMetricBackfillService } from "@/modules/metrics/application/commercial-metric-backfill-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o backfill de métricas comerciais.");
const parsedUrl = new URL(databaseUrl);
const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(parsedUrl.hostname);
if (!isLocal && !process.argv.includes("--allow-production")) throw new Error("Banco remoto exige --allow-production explícito.");
const workspaceSlug = process.argv.find((value) => value.startsWith("--workspace="))?.slice(12);
if (!workspaceSlug) throw new Error("Informe --workspace=<slug>.");
const mode = process.argv.includes("--apply") ? "APPLY" : "DRY_RUN";
const batchSize = Number(process.argv.find((value) => value.startsWith("--batch-size="))?.slice(13) ?? "250");
const runKey = process.argv.find((value) => value.startsWith("--run-key="))?.slice(10) ?? `commercial-metrics:${mode.toLowerCase()}:${new Date().toISOString().slice(0, 10)}`;
const database = getDatabaseClient();

try {
  const member = await database.workspaceMember.findFirst({
    where: { workspace: { slug: workspaceSlug, status: "ACTIVE", deletedAt: null }, status: "ACTIVE", deletedAt: null, role: { key: "administrator" } },
    include: { workspace: true, role: true, user: { include: { actors: { where: { type: "HUMAN" }, orderBy: { createdAt: "asc" }, take: 1 } } } },
  });
  const actor = member?.user.actors[0];
  if (!member || !actor) throw new Error("Administrador ativo não encontrado no workspace informado.");
  const context = { workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, sessionId: "commercial-metrics-backfill-cli", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const result = await getCommercialMetricBackfillService().run(context, { mode, runKey, batchSize });
  process.stdout.write(`${JSON.stringify({ mode, workspaceSlug, result }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n`);
} finally {
  await database.$disconnect();
}
