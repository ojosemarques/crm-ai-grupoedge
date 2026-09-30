import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createConsumptionGovernanceService } from "@/modules/consumption/application/consumption-governance-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for stage 17 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) {
  throw new Error("Stage 17 requires an ephemeral test schema.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 8 }),
});
const authorization = createAuthorizationService({ database });
const clock = new Date("2050-01-15T15:00:00.000Z");
const consumption = createConsumptionGovernanceService({
  database,
  authorization,
  now: () => clock,
});

let workspaceId: string;
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let sdr: AuthenticatedContext;
let otherSdr: AuthenticatedContext;
let closer: AuthenticatedContext;
let otherCloser: AuthenticatedContext;
let salesTeamId: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email } },
    include: { role: true, user: true, workspace: true },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: member.userId, type: "HUMAN" },
  });
  return {
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: member.workspace.slug,
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, {
    DATABASE_URL: connectionString,
    NODE_ENV: "test",
  })).workspaceId;
  [admin, manager, sdr, otherSdr, closer, otherCloser] = await Promise.all([
    context("admin@demo.politizai.local"),
    context("gestor@demo.politizai.local"),
    context("sdr1@demo.politizai.local"),
    context("sdr2@demo.politizai.local"),
    context("closer1@demo.politizai.local"),
    context("closer2@demo.politizai.local"),
  ]);
  salesTeamId = (await database.team.findFirstOrThrow({
    where: { workspaceId, name: "Vendas", deletedAt: null },
    select: { id: true },
  })).id;
});

afterAll(async () => database.$disconnect());

describe("etapa 17 — operação, escopo e consumo", () => {
  it("mantém SDR e closer no próprio registro, gestor na equipe e admin no workspace", async () => {
    await expect(authorization.authorize(sdr, PermissionKeys.LEADS_READ, {
      workspaceId,
      resourceType: "Lead",
      ownerMemberId: sdr.memberId,
    })).resolves.toEqual({ allowed: true, scope: "OWN" });
    await expect(authorization.authorize(sdr, PermissionKeys.LEADS_READ, {
      workspaceId,
      resourceType: "Lead",
      ownerMemberId: otherSdr.memberId,
    })).resolves.toMatchObject({ allowed: false, reason: "OUTSIDE_SCOPE" });
    await expect(authorization.authorize(sdr, PermissionKeys.BULK_ACTIONS_EXECUTE, {
      workspaceId,
      resourceType: "Lead",
      ownerMemberId: sdr.memberId,
    })).resolves.toMatchObject({ allowed: false, reason: "MISSING_PERMISSION" });

    await expect(authorization.authorize(closer, PermissionKeys.OPPORTUNITIES_READ, {
      workspaceId,
      resourceType: "Opportunity",
      ownerMemberId: closer.memberId,
    })).resolves.toEqual({ allowed: true, scope: "OWN" });
    await expect(authorization.authorize(closer, PermissionKeys.OPPORTUNITIES_READ, {
      workspaceId,
      resourceType: "Opportunity",
      ownerMemberId: otherCloser.memberId,
    })).resolves.toMatchObject({ allowed: false, reason: "OUTSIDE_SCOPE" });
    await expect(authorization.authorize(closer, PermissionKeys.EXPORTS_EXECUTE, {
      workspaceId,
      resourceType: "Opportunity",
      ownerMemberId: closer.memberId,
    })).resolves.toMatchObject({ allowed: false, reason: "MISSING_PERMISSION" });

    await expect(authorization.authorize(manager, PermissionKeys.BULK_ACTIONS_EXECUTE, {
      workspaceId,
      resourceType: "Team",
      teamId: salesTeamId,
    })).resolves.toEqual({ allowed: true, scope: "TEAM" });
    await expect(authorization.authorize(manager, PermissionKeys.OPPORTUNITIES_READ, {
      workspaceId,
      resourceType: "Opportunity",
      ownerMemberId: closer.memberId,
    })).resolves.toEqual({ allowed: true, scope: "TEAM" });

    await expect(authorization.authorize(admin, PermissionKeys.EXPORTS_EXECUTE, {
      workspaceId,
      resourceType: "Workspace",
      resourceId: workspaceId,
    })).resolves.toEqual({ allowed: true, scope: "WORKSPACE" });
    await expect(authorization.authorize(admin, PermissionKeys.EXPORTS_EXECUTE, {
      workspaceId: randomUUID(),
      resourceType: "Workspace",
      resourceId: randomUUID(),
    })).resolves.toMatchObject({ allowed: false, reason: "WORKSPACE_MISMATCH" });
  });

  it("pausa somente o recurso cujo orçamento foi excedido", async () => {
    const period = {
      periodStart: new Date("2050-01-01T00:00:00.000Z"),
      periodEnd: new Date("2050-02-01T00:00:00.000Z"),
    };
    const aiBudget = await consumption.configure(admin, {
      resourceType: "AI",
      resourceKey: "agent:qualification",
      currency: "BRL",
      limitCents: 100n,
      limitUnits: 100n,
      includedCreditCents: 0n,
      warningBasisPoints: 8_000,
      ...period,
      status: "ACTIVE",
      reason: "Teto integrado da IA",
    });
    const smsBudget = await consumption.configure(admin, {
      resourceType: "SMS",
      resourceKey: "sms:outbound",
      currency: "BRL",
      limitCents: 100n,
      limitUnits: 100n,
      includedCreditCents: 0n,
      warningBasisPoints: 8_000,
      ...period,
      status: "ACTIVE",
      reason: "Teto integrado de SMS",
    });

    await expect(consumption.record(sdr, {
      resourceType: "AI",
      resourceKey: "agent:qualification",
      amountCents: 80n,
      units: 1n,
      idempotencyKey: "stage17:ai:allowed",
    })).resolves.toMatchObject({ allowed: true, code: "ALLOWED", warning: true });
    await expect(consumption.record(sdr, {
      resourceType: "AI",
      resourceKey: "agent:qualification",
      amountCents: 21n,
      units: 1n,
      idempotencyKey: "stage17:ai:blocked",
    })).resolves.toMatchObject({ allowed: false, code: "MONEY_LIMIT_EXCEEDED" });
    await expect(consumption.record(sdr, {
      resourceType: "SMS",
      resourceKey: "sms:outbound",
      amountCents: 10n,
      units: 1n,
      idempotencyKey: "stage17:sms:allowed",
    })).resolves.toMatchObject({ allowed: true, code: "ALLOWED" });

    const [persistedAi, persistedSms, pauseAudit] = await Promise.all([
      database.consumptionBudget.findUniqueOrThrow({ where: { id: aiBudget.id } }),
      database.consumptionBudget.findUniqueOrThrow({ where: { id: smsBudget.id } }),
      database.auditLog.findFirst({
        where: {
          workspaceId,
          action: "consumption.budget.auto_paused",
          entityType: "ConsumptionBudget",
          entityId: aiBudget.id,
        },
      }),
    ]);
    expect(persistedAi).toMatchObject({ status: "PAUSED", pausedReason: "MONEY_LIMIT_EXCEEDED" });
    expect(persistedSms).toMatchObject({ status: "ACTIVE", pausedReason: null });
    expect(pauseAudit).not.toBeNull();
    await expect(consumption.assertCanConsume(sdr, "AI", "agent:qualification", 1n, 0n))
      .resolves.toEqual({ allowed: false, code: "BUDGET_PAUSED" });
    await expect(consumption.assertCanConsume(sdr, "SMS", "sms:outbound", 1n, 0n))
      .resolves.toEqual({ allowed: true, code: "ALLOWED" });
  });
});
