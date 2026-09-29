import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { ensureStagingLeadPipeline } from "@/modules/settings/application/staging-homologation-service";
import { leadStageCodes } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for staging pipeline tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 8 }) });

afterAll(async () => database.$disconnect());

describe("configuração sintética do pipeline de staging", () => {
  it("repara um pipeline apenas com NEW e repete sem duplicar etapas, transições ou motivo", async () => {
    const suffix = randomUUID().slice(0, 8);
    const workspace = await database.workspace.create({
      data: { slug: `prod10-pipeline-${suffix}`, name: `PROD-10 pipeline ${suffix}` },
    });
    const actor = await database.actor.create({
      data: {
        workspaceId: workspace.id,
        type: "SYSTEM",
        key: "system",
        displayName: "Sistema sintético PROD-10",
      },
    });
    const pipeline = await database.pipeline.create({
      data: {
        workspaceId: workspace.id,
        name: "Pré-vendas incompleto",
        entityType: "LEAD",
        isDefault: true,
        createdByActorId: actor.id,
        updatedByActorId: actor.id,
      },
    });
    await database.pipelineStage.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        name: "Novo",
        position: 0,
        type: "OPEN",
        leadStageCode: "NEW",
        createdByActorId: actor.id,
        updatedByActorId: actor.id,
      },
    });

    const first = await database.$transaction((transaction) => (
      ensureStagingLeadPipeline(transaction, workspace.id, actor.id)
    ));
    const second = await database.$transaction((transaction) => (
      ensureStagingLeadPipeline(transaction, workspace.id, actor.id)
    ));
    const [stages, transitions, reasons, audits] = await Promise.all([
      database.pipelineStage.findMany({
        where: { workspaceId: workspace.id, pipelineId: pipeline.id, deletedAt: null },
        orderBy: { position: "asc" },
        select: { leadStageCode: true },
      }),
      database.pipelineStageTransition.count({ where: { workspaceId: workspace.id, pipelineId: pipeline.id } }),
      database.disqualificationReason.count({
        where: { workspaceId: workspace.id, key: "synthetic-prod10-pipeline", deletedAt: null },
      }),
      database.auditLog.count({
        where: { workspaceId: workspace.id, action: "prod10.pipeline_configuration.repaired" },
      }),
    ]);

    expect(stages.map((stage) => stage.leadStageCode)).toEqual(leadStageCodes);
    expect(transitions).toBe(23);
    expect(reasons).toBe(1);
    expect(audits).toBe(1);
    expect(first).toMatchObject({ stageCount: 8, createdStageCodes: leadStageCodes.slice(1), changed: true });
    expect(second).toMatchObject({
      stageCount: 8,
      createdStageCodes: [],
      createdTransitions: 0,
      reactivatedTransitions: 0,
      changed: false,
    });
  });
});
