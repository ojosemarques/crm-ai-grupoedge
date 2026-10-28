import "dotenv/config";
import { getDatabaseClient } from "@/shared/core/database/client";

// Read-only inventory. Never print environment values, payloads or personal data.
const url = new URL(process.env.DATABASE_URL!);
if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) || process.env.APP_ENV !== "production") throw new Error("Inventário de produção exige configuração remota explícita, sem fallback local.");
const database = getDatabaseClient();
try {
  const identity = await database.$queryRaw<{ database: string; schema: string; role: string }[]>`SELECT current_database() AS database, current_schema() AS schema, current_user AS role`;
  const workspaces = await database.workspace.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, slug: true, timeZone: true } });
  const inventory = [];
  for (const workspace of workspaces) {
    const pipelines = await database.pipeline.findMany({ where: { workspaceId: workspace.id, entityType: "LEAD", deletedAt: null }, select: { id: true, name: true, _count: { select: { leads: true } } } });
    const facts = await database.commercialMetricFact.groupBy({ by: ["eventType"], where: { workspaceId: workspace.id }, _count: { _all: true } });
    const missingFront = await database.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM commercial_metric_facts WHERE "workspaceId" = ${workspace.id}::uuid AND ("safeMetadata" IS NULL OR NOT ("safeMetadata" ? '_commercialFrontPipelineId'))`;
    inventory.push({ ...workspace, pipelines, facts, missingFront: Number(missingFront[0]!.count) });
  }
  console.log(JSON.stringify({ databaseHost: url.hostname, identity, canonicalUrl: process.env.APP_CANONICAL_URL, worker: { enabled: process.env.SERVERLESS_WORKER_ENABLED, role: process.env.PROCESS_ROLE }, inventory }));
} finally { await database.$disconnect(); }
