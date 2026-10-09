import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createMetricsService } from "@/modules/metrics/application/metrics-service";

const context = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  memberId: "10000000-0000-4000-8000-000000000002",
} as AuthenticatedContext;

describe("recorte temporal das métricas integradas", () => {
  it("atribui EMAIL_SCHEDULED à data programada do job, não à data em que a cadência foi criada", async () => {
    const scheduledAt = new Date("2026-10-09T13:30:00.000Z");
    const jobId = "10000000-0000-4000-8000-000000000003";
    const factId = "10000000-0000-4000-8000-000000000004";
    const findFacts = vi.fn(async ({ where }: { where: { sourceEntityId?: { in?: string[] }; NOT?: unknown } }) => where.sourceEntityId
      ? [{
          id: factId,
          eventType: "EMAIL_SCHEDULED",
          sourceEntityType: "ProspectingEmailJob",
          sourceEntityId: jobId,
          leadId: null,
          creditedMemberId: context.memberId,
          performedByMemberId: null,
          bookedByMemberId: null,
          taskKind: null,
          result: "SCHEDULED",
          cadenceStepKey: "email-2",
          quantity: 1,
          valueCents: null,
        }]
      : where.NOT ? [] : [{
          id: factId,
          eventType: "EMAIL_SCHEDULED",
          sourceEntityType: "ProspectingEmailJob",
          occurredAt: new Date("2026-10-08T13:30:00.000Z"),
          leadId: null,
          creditedMemberId: context.memberId,
          performedByMemberId: null,
          bookedByMemberId: null,
          taskKind: null,
          result: "SCHEDULED",
          cadenceStepKey: "email-2",
          quantity: 1,
          valueCents: null,
        }]);
    const findJobs = vi.fn(async () => [{ id: jobId, scheduledAt }]);
    const database = {
      teamMember: { findMany: vi.fn(async () => []) },
      prospectingEmailJob: { findMany: findJobs },
      commercialMetricFact: { findMany: findFacts },
    } as unknown as PrismaClient;
    const authorization = {
      authorize: vi.fn(async () => ({ allowed: true, scope: "WORKSPACE" } as const)),
      assertAuthorized: vi.fn(async () => undefined),
    };
    const service = createMetricsService({ database, authorization, now: () => scheduledAt });

    const facts = await service.getIntegratedActivityFacts(context, {
      from: "2026-10-09T03:00:00.000Z",
      to: "2026-10-10T03:00:00.000Z",
      filters: {},
    });

    expect(findJobs).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        scheduledAt: { gte: new Date("2026-10-09T03:00:00.000Z"), lt: new Date("2026-10-10T03:00:00.000Z") },
      }),
    }));
    expect(facts).toEqual([expect.objectContaining({
      id: factId,
      eventType: "EMAIL_SCHEDULED",
      occurredAt: scheduledAt.toISOString(),
    })]);
  });
});
