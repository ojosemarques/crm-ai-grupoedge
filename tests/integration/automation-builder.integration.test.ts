import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { acceptanceGraph, createAutomationBuilderService } from "@/modules/automations/application/automation-builder-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for automation builder tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 8 }) });
const authorization = createAuthorizationService({ database });
let admin: AuthenticatedContext;
let now = new Date("2045-11-01T12:00:00.000Z");

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId: seeded.workspaceId, user: { normalizedEmail: "admin@demo.politizai.local" }, deletedAt: null },
    select: { id: true, userId: true, roleId: true, role: { select: { key: true, name: true } }, user: { select: { displayName: true } } },
  });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, userId: member.userId, type: "HUMAN" }, select: { id: true } });
  admin = { sessionId: randomUUID(), workspaceId: seeded.workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
});

afterAll(async () => database.$disconnect());

function service() {
  return createAutomationBuilderService({ database, authorization, now: () => new Date(now) });
}

describe("stage 11 visual automation builder", () => {
  it("publica versões imutáveis e mantém runs antigos no snapshot de origem", async () => {
    const builder = service();
    const draft = await builder.command(admin, { action: "CREATE_DRAFT", payload: { graph: acceptanceGraph } }) as { ruleId: string; draftRevision: number };
    const first = await builder.command(admin, { action: "PUBLISH", payload: { ruleId: draft.ruleId, expectedRevision: draft.draftRevision } }) as { versionId: string; version: number };
    const started = await builder.command(admin, { action: "START_RUN", payload: { ruleId: draft.ruleId, idempotencyKey: `stage11:${randomUUID()}`, payload: { qualified: true } } }) as { runId: string };

    const changed = structuredClone(acceptanceGraph);
    changed.name = "Fluxo revisado sem alterar execução antiga";
    const saved = await builder.command(admin, { action: "SAVE_DRAFT", payload: { ruleId: draft.ruleId, expectedRevision: draft.draftRevision, graph: changed } }) as { draftRevision: number };
    const second = await builder.command(admin, { action: "PUBLISH", payload: { ruleId: draft.ruleId, expectedRevision: saved.draftRevision } }) as { versionId: string; version: number };
    expect(second.version).toBe(2);

    const run = await database.automationRun.findUniqueOrThrow({ where: { id: started.runId }, select: { automationRuleVersionId: true, graphSnapshot: true, executionPolicy: true } });
    expect(run.automationRuleVersionId).toBe(first.versionId);
    expect(run.executionPolicy).toBe("CONTINUE_SNAPSHOT");
    expect((run.graphSnapshot as { name: string }).name).toBe(acceptanceGraph.name);
    await expect(database.automationRuleVersion.update({ where: { id: first.versionId }, data: { graphHash: "mutated" } })).rejects.toThrow();
  });

  it("executa o caminho de aceite por nó sem duplicar o efeito do mesmo nó", async () => {
    now = new Date("2045-11-02T12:00:00.000Z");
    const builder = service();
    const draft = await builder.command(admin, { action: "CREATE_DRAFT", payload: { graph: acceptanceGraph } }) as { ruleId: string; draftRevision: number };
    await builder.command(admin, { action: "PUBLISH", payload: { ruleId: draft.ruleId, expectedRevision: draft.draftRevision } });
    const key = `stage11:${randomUUID()}`;
    const lead = await createLeadIntakeService({ database, authorization, now: () => now }).intake({ channel: "MANUAL", idempotencyKey: `stage11-lead:${randomUUID()}`, fullName: "Lead da automação visual", phone: "+5511999111101", interestSummary: "Validar tarefa e handoff idempotentes", sourceKey: "manual", priorityBandCode: "P2", rawPayload: { test: "stage11" } }, admin);
    if (lead.outcome === "REJECTED") throw new Error(`Intake rejeitado: ${lead.code}`);
    const first = await builder.command(admin, { action: "START_RUN", payload: { ruleId: draft.ruleId, idempotencyKey: key, leadId: lead.leadId, payload: { qualified: true } } }) as { runId: string; jobId: string; duplicated: boolean };
    const duplicate = await builder.command(admin, { action: "START_RUN", payload: { ruleId: draft.ruleId, idempotencyKey: key, leadId: lead.leadId, payload: { qualified: true } } }) as typeof first;
    expect(duplicate).toMatchObject({ runId: first.runId, jobId: first.jobId, duplicated: true });

    for (let step = 0; step < 7; step += 1) {
      await builder.command(admin, { action: "ADVANCE_RUN", payload: { runId: first.runId } });
      now = new Date(now.getTime() + 60_000);
    }
    const nodeRuns = await database.automationNodeRun.findMany({ where: { automationRunId: first.runId }, orderBy: { startedAt: "asc" }, select: { nodeId: true, idempotencyKey: true } });
    expect(nodeRuns.map((node) => node.nodeId)).toEqual(["lead", "triage", "task", "wait", "condition", "handoff", "end"]);
    expect(new Set(nodeRuns.map((node) => node.idempotencyKey)).size).toBe(nodeRuns.length);
    expect(await database.automationRun.findUniqueOrThrow({ where: { id: first.runId }, select: { status: true } })).toMatchObject({ status: "SUCCEEDED" });
    expect(await database.task.count({ where: { automationRunId: first.runId } })).toBe(1);
    expect(await database.customerHandoff.count({ where: { automationRunId: first.runId } })).toBe(1);
  });
});
