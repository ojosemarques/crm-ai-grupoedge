import "dotenv/config";

import { Prisma } from "@/generated/prisma/client";
import { createProspectingReconciliationService } from "@/modules/prospecting/application/prospecting-reconciliation-service";
import { PROSPECTING_CADENCE_VERSION } from "@/modules/prospecting/domain/prospecting-cadence";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para reparar a cadência de WhatsApp.");
const parsedUrl = new URL(databaseUrl);
const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(parsedUrl.hostname);
const allowProduction = process.argv.includes("--allow-production");
const execute = process.argv.includes("--execute");
if (!isLocal && !allowProduction) throw new Error("Banco remoto exige --allow-production explícito.");
const workspaceSlug = process.argv.find((value) => value.startsWith("--workspace="))?.slice("--workspace=".length);
if (!workspaceSlug) throw new Error("Informe --workspace=<slug>.");

const database = getDatabaseClient();
try {
  const workspace = await database.workspace.findFirstOrThrow({
    where: { slug: workspaceSlug, status: "ACTIVE", deletedAt: null },
    select: { id: true, slug: true },
  });
  const [preview] = await database.$queryRaw<Array<{ cadences: bigint; tasks: bigint }>>(Prisma.sql`
    WITH desired("stepKey", "referenceStepKey") AS (VALUES
      ('whatsapp-1', 'instagram-follow'),
      ('whatsapp-2', 'instagram-message-2'),
      ('whatsapp-3', 'instagram-message-3'),
      ('whatsapp-4', 'instagram-message-4')
    ), missing AS (
      SELECT cadence."id", desired."stepKey"
      FROM "prospecting_cadence_instances" cadence
      JOIN "leads" lead
        ON lead."workspaceId" = cadence."workspaceId"
       AND lead."id" = cadence."leadId"
       AND lead."deletedAt" IS NULL
      JOIN "pipeline_stages" stage
        ON stage."workspaceId" = lead."workspaceId"
       AND stage."id" = lead."currentStageId"
       AND stage."stableKey" IN (
         'active-prospecting.new-lead',
         'active-prospecting.initial-outreach',
         'active-prospecting.active-cadence'
       )
      CROSS JOIN desired
      JOIN "prospecting_cadence_steps" reference_step
        ON reference_step."workspaceId" = cadence."workspaceId"
       AND reference_step."cadenceInstanceId" = cadence."id"
       AND reference_step."stepKey" = desired."referenceStepKey"
      WHERE cadence."workspaceId" = ${workspace.id}::uuid
        AND cadence."templateVersion" < ${PROSPECTING_CADENCE_VERSION}
        AND cadence."status"::text IN ('PENDING_D1', 'ACTIVE', 'PAUSED')
        AND NOT EXISTS (
          SELECT 1 FROM "prospecting_cadence_steps" existing_step
          WHERE existing_step."workspaceId" = cadence."workspaceId"
            AND existing_step."cadenceInstanceId" = cadence."id"
            AND existing_step."stepKey" = desired."stepKey"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "tasks" existing_task
          WHERE existing_task."workspaceId" = cadence."workspaceId"
            AND existing_task."sourceKey" = 'active-prospecting:' || cadence."id"::text || ':' || desired."stepKey"
        )
    )
    SELECT COUNT(DISTINCT "id")::bigint AS cadences, COUNT(*)::bigint AS tasks FROM missing
  `);
  const summary = { workspace: workspace.slug, cadences: Number(preview?.cadences ?? 0n), tasks: Number(preview?.tasks ?? 0n) };
  if (!execute) {
    process.stdout.write(`${JSON.stringify({ mode: "DRY_RUN", ...summary })}\n`);
  } else {
    const service = createProspectingReconciliationService({ database, now: () => new Date() });
    let repaired = 0;
    let upgradedCadences = 0;
    for (let batch = 0; batch < 1_000; batch += 1) {
      const result = await service.repairMissingWhatsappCadenceTasks(`manual:whatsapp-backfill:${batch + 1}`, workspace.id);
      repaired += result.repaired;
      upgradedCadences += result.upgradedCadences;
      if (result.status === "IDLE") break;
      if (batch === 999) throw new Error("Backfill excedeu o limite de 1.000 lotes.");
    }
    process.stdout.write(`${JSON.stringify({ mode: "EXECUTE", ...summary, repaired, upgradedCadences })}\n`);
  }
} finally {
  await database.$disconnect();
}
