import { PrismaClient } from "@/generated/prisma/client";
import { createAuthenticationService } from "@/modules/auth/application/authentication-service";
import { createMetricsService } from "@/modules/metrics/application/metrics-service";
import {
  CRM29_DEMO_LEAD_COUNT,
  CRM29_DEMO_NAMESPACE,
  seedCrm29DemoData,
} from "@/modules/settings/application/crm29-demo-data-service";
import {
  DEMO_SEED_PASSWORD,
  DEMO_WORKSPACE_SLUG,
  seedDemoDatabase,
} from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { parseAIOutput } from "@/modules/ai/domain/ai-contracts";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-29 tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 5 }) });
const localEnvironment = { NODE_ENV: "test", DATABASE_URL: connectionString };
const testStartedAt = new Date();
let seeded: Awaited<ReturnType<typeof seedCrm29DemoData>>;

async function operationalSnapshot(workspaceId: string) {
  const priorities = await database.leadCurrentScore.groupBy({
    by: ["workspaceId"],
    where: { workspaceId },
    _count: { _all: true },
  });
  const stageCounts = await database.lead.groupBy({
    by: ["currentStageId"], where: { workspaceId }, _count: { _all: true },
  });
  return {
    leads: await database.lead.count({ where: { workspaceId } }),
    submissions: await database.leadFormSubmission.count({ where: { workspaceId } }),
    assignments: await database.leadAssignment.count({ where: { workspaceId } }),
    slaCycles: await database.leadSlaCycle.count({ where: { workspaceId } }),
    tasks: await database.task.count({ where: { workspaceId } }),
    activities: await database.activity.count({ where: { workspaceId } }),
    stageHistory: await database.stageHistory.count({ where: { workspaceId } }),
    scores: priorities[0]?._count._all ?? 0,
    stageCounts: stageCounts.map(({ currentStageId, _count }) => [currentStageId, _count._all]).sort(),
    meetings: await database.meeting.count({ where: { workspaceId } }),
    opportunities: await database.opportunity.count({ where: { workspaceId } }),
    automationRuns: await database.automationRun.count({ where: { workspaceId } }),
    aiInsights: await database.aIInsight.count({ where: { workspaceId } }),
    auditLogs: await database.auditLog.count({ where: { workspaceId } }),
  };
}

describe("base demonstrativa CRM-29", () => {
  beforeAll(async () => {
    await seedDemoDatabase(database, localEnvironment);
    seeded = await seedCrm29DemoData(database, localEnvironment);
  }, 120_000);

  afterAll(async () => {
    await database.$disconnect();
  });

  it("cria 320 identidades fictícias, 32 reconversões e exemplos em todos os eixos", async () => {
    expect(seeded).toMatchObject({
      namespace: CRM29_DEMO_NAMESPACE,
      leads: CRM29_DEMO_LEAD_COUNT,
      submissions: 352,
      duplicateSubmissions: 32,
      meetings: 80,
      automationRuns: 64,
      aiInsights: 48,
    });
    expect(seeded.wins).toBeGreaterThan(0);
    expect(seeded.losses).toBeGreaterThan(0);
    expect(seeded.noShows).toBeGreaterThan(0);
    expect(seeded.cancelledMeetings).toBeGreaterThan(0);

    const workspace = await database.workspace.findUniqueOrThrow({ where: { id: seeded.workspaceId } });
    const [priorityCounts, stageCounts, sources, campaigns, creatives, locations, jobTitles, products, closers, jobs, pacto, violations] = await Promise.all([
      database.leadScore.groupBy({ by: ["priorityBandCode"], where: { workspaceId: workspace.id, currentRevision: 1 }, _count: { _all: true } }),
      database.lead.groupBy({ by: ["currentStageId"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
      database.lead.groupBy({ by: ["sourceId"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
      database.lead.groupBy({ by: ["campaignId"], where: { workspaceId: workspace.id, campaignId: { not: null } }, _count: { _all: true } }),
      database.lead.groupBy({ by: ["creativeId"], where: { workspaceId: workspace.id, creativeId: { not: null } }, _count: { _all: true } }),
      database.lead.groupBy({ by: ["stateCode", "city"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
      database.lead.groupBy({ by: ["jobTitle"], where: { workspaceId: workspace.id, jobTitle: { not: null } }, _count: { _all: true } }),
      database.opportunity.groupBy({ by: ["productId"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
      database.opportunity.groupBy({ by: ["ownerMemberId"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
      database.task.groupBy({ by: ["status"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
      database.leadQualification.groupBy({ by: ["status"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
      database.processViolation.groupBy({ by: ["type"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
    ]);
    expect(Object.fromEntries(priorityCounts.map((row) => [row.priorityBandCode, row._count._all]))).toEqual({ P1: 80, P2: 140, P3: 100 });
    expect(stageCounts).toHaveLength(8);
    expect(sources).toHaveLength(5);
    expect(campaigns).toHaveLength(2);
    expect(creatives).toHaveLength(4);
    expect(locations).toHaveLength(10);
    expect(jobTitles).toHaveLength(6);
    expect(products).toHaveLength(3);
    expect(closers).toHaveLength(2);
    expect(jobs.map(({ status }) => status)).toEqual(expect.arrayContaining(["OPEN", "COMPLETED"]));
    expect(pacto.map(({ status }) => status)).toEqual(expect.arrayContaining(["IN_PROGRESS", "COMPLETED"]));
    expect(violations.map(({ type }) => type)).toEqual(expect.arrayContaining(["SLA_VIOLATED", "LEAD_STAGNANT", "LEAD_WITHOUT_NEXT_ACTION"]));

    const insights = await database.aIInsight.findMany({
      where: { workspaceId: workspace.id },
      select: {
        agentType: true,
        facts: true,
        inferences: true,
        missingData: true,
        evidence: true,
      },
    });
    expect(insights).toHaveLength(48);
    for (const insight of insights) {
      const evidence = insight.evidence as Record<string, unknown>;
      expect(() => parseAIOutput(insight.agentType, {
        agent: insight.agentType,
        summary: evidence.summary,
        facts: insight.facts,
        inferences: insight.inferences,
        missingFields: insight.missingData,
        evidence: evidence.evidence,
        pacto: evidence.pacto,
        questions: evidence.questions,
        score: evidence.score,
        priority: evidence.priority,
        action: evidence.action,
        alternativeAction: evidence.alternativeAction,
        urgency: evidence.urgency,
        confidence: evidence.confidence,
        risks: evidence.risks,
      })).not.toThrow();
    }
  });

  it("é idempotente e preserva um registro manual fora do namespace", async () => {
    const workspace = await database.workspace.findUniqueOrThrow({ where: { id: seeded.workspaceId } });
    const system = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "system" } });
    const manual = await database.tag.create({
      data: {
        workspaceId: workspace.id,
        name: "Registro manual preservado CRM-29",
        createdByActorId: system.id,
        updatedByActorId: system.id,
      },
    });
    const before = await operationalSnapshot(workspace.id);
    const second = await seedCrm29DemoData(database, localEnvironment, { now: new Date(testStartedAt.getTime() + 7 * 86_400_000) });
    const after = await operationalSnapshot(workspace.id);

    expect(second).toEqual(seeded);
    expect(after).toEqual(before);
    await expect(database.tag.findUnique({ where: { id: manual.id } })).resolves.toMatchObject({ name: manual.name });
  });

  it("mantém integridade temporal, histórica e de desfecho", async () => {
    const anchoredAt = new Date(seeded.anchoredAt);
    expect(anchoredAt.getTime()).toBeGreaterThanOrEqual(testStartedAt.getTime() - 5_000);
    expect(anchoredAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);

    const extrema = await database.lead.aggregate({
      where: { workspaceId: seeded.workspaceId },
      _min: { createdAt: true }, _max: { createdAt: true },
    });
    expect(extrema._min.createdAt!.getTime()).toBeGreaterThanOrEqual(anchoredAt.getTime() - 30 * 86_400_000);
    expect(extrema._max.createdAt!.getTime()).toBeLessThan(anchoredAt.getTime());

    const [cancelledInvalid, noShowInvalid, orphanedOwners, won] = await Promise.all([
      database.meeting.count({ where: { workspaceId: seeded.workspaceId, status: "CANCELLED", OR: [{ noShowAt: { not: null } }, { completedAt: { not: null } }] } }),
      database.meeting.count({ where: { workspaceId: seeded.workspaceId, status: "NO_SHOW", OR: [{ cancelledAt: { not: null } }, { completedAt: { not: null } }] } }),
      database.lead.count({ where: { workspaceId: seeded.workspaceId, ownerMemberId: null, queueId: null } }),
      database.opportunity.findMany({
        where: { workspaceId: seeded.workspaceId, status: "WON" },
        include: { stageHistory: { include: { stage: true }, orderBy: { enteredAt: "asc" } }, offers: true },
      }),
    ]);
    expect(cancelledInvalid).toBe(0);
    expect(noShowInvalid).toBe(0);
    expect(orphanedOwners).toBe(0);
    expect(won.length).toBe(seeded.wins);
    for (const opportunity of won) {
      expect(opportunity.stageHistory.map(({ stage }) => stage.opportunityStageCode)).toEqual([
        "MEETING_SCHEDULED", "MEETING_HELD", "OPPORTUNITY_CONFIRMED", "PROPOSAL", "NEGOTIATION", "WON",
      ]);
      expect(opportunity.offers.length).toBeGreaterThan(0);
      expect(opportunity.amountCents).toBeGreaterThan(0n);
      expect(opportunity.closedAt).not.toBeNull();
    }
  });

  it("reconcilia a coorte de 30 dias e os denominadores da camada de métricas", async () => {
    const authentication = createAuthenticationService({ database, sessionTtlHours: 8, maxFailedAttempts: 5, lockMinutes: 15 });
    const login = await authentication.login({
      workspaceSlug: DEMO_WORKSPACE_SLUG,
      email: "admin@demo.politizai.local",
      password: DEMO_SEED_PASSWORD,
      request: { ipAddress: "127.0.0.1", userAgent: "vitest-crm29" },
    });
    const metrics = createMetricsService({ database, authorization: createAuthorizationService({ database }), now: () => new Date() });
    const from = new Date(new Date(seeded.anchoredAt).getTime() - 30 * 86_400_000);
    const to = new Date(new Date(seeded.anchoredAt).getTime() + 2 * 86_400_000);
    const overview = await metrics.getOverview(login.context, { from: from.toISOString(), to: to.toISOString() });

    expect(overview.leadsReceived.value).toBe(CRM29_DEMO_LEAD_COUNT);
    expect(overview.attemptRate.denominator).toBe(CRM29_DEMO_LEAD_COUNT);
    expect(overview.attemptRate.numerator).toBeGreaterThan(0);
    expect(overview.contactRate.denominator).toBe(overview.attemptRate.numerator);
    expect(overview.showRate.denominator).toBe(overview.showRate.numerator + overview.noShowRate.numerator);
    expect(overview.revenue.numerator).toBe(seeded.wins);
    expect(BigInt(overview.revenue.cents)).toBeGreaterThan(0n);
    expect(overview.humanSla.missingCount).toBeGreaterThan(0);
    expect(overview.humanSla.upTo60Seconds).toBeGreaterThan(0);
    expect(overview.humanSla.upTo180Seconds).toBeGreaterThan(0);
    await authentication.logout(login.token);
  });
});
