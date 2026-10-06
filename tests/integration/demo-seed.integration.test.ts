import { randomUUID } from "node:crypto";

import { PrismaClient } from "@/generated/prisma/client";
import { createAuthenticationService } from "@/modules/auth/application/authentication-service";
import { InvalidCredentialsError } from "@/modules/auth/domain/auth-errors";
import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
  seedDemoDatabase,
} from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for demo seed integration tests.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 5 }),
});
const localEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: connectionString,
};
const requestMetadata = Object.freeze({
  ipAddress: "127.0.0.1",
  userAgent: "vitest-seed",
});

async function getWorkspace() {
  return database.workspace.findUniqueOrThrow({
    where: { slug: DEMO_WORKSPACE_SLUG },
  });
}

async function getStructuralSnapshot(workspaceId: string) {
  const emails = DEMO_USERS.map(({ email }) => email);
  const users = await database.user.findMany({
    where: { normalizedEmail: { in: emails } },
    orderBy: { normalizedEmail: "asc" },
    select: {
      id: true,
      normalizedEmail: true,
      displayName: true,
      status: true,
      updatedAt: true,
      credential: {
        select: {
          id: true,
          passwordHash: true,
          credentialVersion: true,
          updatedAt: true,
        },
      },
    },
  });

  const [
    workspace,
    actors,
    roles,
    grants,
    members,
    teams,
    teamMembers,
    queues,
    pipelines,
    stages,
    slaPolicies,
    priorityBands,
    lossReasons,
    disqualificationReasons,
    products,
    offerTemplates,
    sources,
    campaigns,
    creatives,
    commercialSettings,
    cadenceSteps,
    pipelineTransitions,
    seedAudits,
  ] = await Promise.all([
    database.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, slug: true, name: true, timeZone: true, updatedAt: true },
    }),
    database.actor.findMany({
      where: {
        workspaceId,
        key: {
          in: [
            "system",
            "automation:local",
            "ai:recommendation",
            ...users.map(({ id }) => `user:${id}`),
          ],
        },
      },
      orderBy: { id: "asc" },
      select: { id: true, key: true, type: true, userId: true },
    }),
    database.role.findMany({
      where: { workspaceId },
      orderBy: { key: "asc" },
      select: { id: true, key: true, name: true, updatedAt: true, deletedAt: true },
    }),
    database.rolePermission.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
      select: { id: true, roleId: true, permissionId: true, scope: true },
    }),
    database.workspaceMember.findMany({
      where: { workspaceId, userId: { in: users.map(({ id }) => id) } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        userId: true,
        roleId: true,
        status: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
    database.team.findMany({
      where: { workspaceId, name: { in: ["Pré-vendas", "Vendas"] } },
      orderBy: { id: "asc" },
      select: { id: true, name: true, updatedAt: true, deletedAt: true },
    }),
    database.teamMember.findMany({
      where: {
        workspaceId,
        member: { userId: { in: users.map(({ id }) => id) } },
        team: { name: { in: ["Pré-vendas", "Vendas"] } },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        teamId: true,
        workspaceMemberId: true,
        function: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
    database.queue.findMany({
      where: { workspaceId, key: "general" },
      orderBy: { id: "asc" },
      select: {
        id: true,
        key: true,
        teamId: true,
        isGeneral: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
    database.pipeline.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        entityType: true,
        isDefault: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
    database.pipelineStage.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        pipelineId: true,
        name: true,
        position: true,
        type: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
    database.slaPolicy.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
    }),
    database.leadPriorityBand.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
    }),
    database.lossReason.findMany({
      where: {
        workspaceId,
        key: { in: ["no-budget", "no-priority", "competitor", "no-response", "timing"] },
      },
      orderBy: { id: "asc" },
    }),
    database.disqualificationReason.findMany({
      where: {
        workspaceId,
        key: { in: ["outside-profile", "no-clear-problem", "no-authority", "no-timing", "invalid-data"] },
      },
      orderBy: { id: "asc" },
    }),
    database.product.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
    }),
    database.offerTemplate.findMany({
      where: { workspaceId },
      orderBy: { id: "asc" },
    }),
    database.leadSource.findMany({
      where: { workspaceId, key: { in: ["manual", "website", "referral", "paid-media", "organic"] } },
      orderBy: { id: "asc" },
    }),
    database.acquisitionCampaign.findMany({
      where: { workspaceId, externalRef: { startsWith: "demo:campaign:" } },
      orderBy: { id: "asc" },
    }),
    database.acquisitionCreative.findMany({
      where: { workspaceId, externalRef: { startsWith: "demo:creative:" } },
      orderBy: { id: "asc" },
    }),
    database.commercialSettingsVersion.findMany({
      where: { workspaceId },
      orderBy: { revision: "asc" },
      include: { cadence: { orderBy: { attemptNumber: "asc" } } },
    }),
    database.cadenceStep.findMany({
      where: { workspaceId },
      orderBy: [{ settingsVersionId: "asc" }, { attemptNumber: "asc" }],
    }),
    database.pipelineStageTransition.findMany({
      where: { workspaceId },
      orderBy: [{ pipelineId: "asc" }, { fromStageId: "asc" }, { toStageId: "asc" }],
    }),
    database.auditLog.findMany({
      where: { workspaceId, action: "seed.initial_structure.created" },
      orderBy: { id: "asc" },
      select: { id: true, action: true, entityId: true, changes: true, metadata: true },
    }),
  ]);

  return {
    workspace,
    users,
    actors,
    roles,
    grants,
    members,
    teams,
    teamMembers,
    queues,
    pipelines,
    stages,
    slaPolicies,
    priorityBands,
    lossReasons,
    disqualificationReasons,
    products,
    offerTemplates,
    sources,
    campaigns,
    creatives,
    commercialSettings,
    cadenceSteps,
    pipelineTransitions,
    seedAudits,
  };
}

describe("seed estrutural de demonstração", () => {
  beforeAll(async () => {
    await seedDemoDatabase(database, localEnvironment);
  }, 30_000);

  afterAll(async () => {
    await database.$disconnect();
  });

  it("é idempotente inclusive para IDs, hashes, timestamps e auditoria", async () => {
    const workspace = await getWorkspace();
    const before = await getStructuralSnapshot(workspace.id);

    await seedDemoDatabase(database, localEnvironment);
    const after = await getStructuralSnapshot(workspace.id);

    expect(after).toEqual(before);
    expect(after.seedAudits).toHaveLength(1);
  });

  it("cria a contagem estrutural esperada sem alterar leads ou ofertas operacionais", async () => {
    const workspace = await getWorkspace();
    const snapshot = await getStructuralSnapshot(workspace.id);
    const operationalCountsBefore = await Promise.all([
      database.lead.count({ where: { workspaceId: workspace.id } }),
      database.offer.count({ where: { workspaceId: workspace.id } }),
    ]);

    await seedDemoDatabase(database, localEnvironment);

    const operationalCountsAfter = await Promise.all([
      database.lead.count({ where: { workspaceId: workspace.id } }),
      database.offer.count({ where: { workspaceId: workspace.id } }),
    ]);

    expect(snapshot.users).toHaveLength(8);
    expect(snapshot.users.every(({ credential }) => credential !== null)).toBe(true);
    expect(snapshot.actors).toHaveLength(11);
    expect(snapshot.roles).toHaveLength(5);
    expect(snapshot.grants).toHaveLength(462);
    expect(snapshot.members).toHaveLength(8);
    expect(snapshot.teams).toHaveLength(2);
    expect(snapshot.teamMembers).toHaveLength(7);
    expect(snapshot.queues).toHaveLength(1);
    expect(snapshot.queues[0]).toMatchObject({ isGeneral: true });
    expect(snapshot.pipelines).toHaveLength(3);
    expect(snapshot.stages).toHaveLength(22);
    expect(snapshot.commercialSettings).toHaveLength(1);
    expect(snapshot.cadenceSteps.map(({ dayOffset }) => dayOffset)).toEqual([1, 2, 3, 5, 7]);
    expect(snapshot.pipelineTransitions).toHaveLength(45);
    expect(snapshot.slaPolicies).toHaveLength(3);
    expect(snapshot.priorityBands.map(({ code }) => code).sort()).toEqual([
      "P1",
      "P2",
      "P3",
    ]);
    expect(snapshot.lossReasons).toHaveLength(5);
    expect(snapshot.disqualificationReasons).toHaveLength(5);
    expect(snapshot.products).toHaveLength(3);
    expect(snapshot.offerTemplates).toHaveLength(3);
    expect(snapshot.sources).toHaveLength(5);
    expect(snapshot.campaigns).toHaveLength(2);
    expect(snapshot.creatives).toHaveLength(4);
    expect(operationalCountsAfter).toEqual(operationalCountsBefore);
  });

  it("permite login local de todos os usuários e preserva o papel esperado", async () => {
    const workspace = await getWorkspace();
    const authentication = createAuthenticationService({
      database,
      sessionTtlHours: 8,
      maxFailedAttempts: 5,
      lockMinutes: 15,
    });

    for (const definition of DEMO_USERS) {
      const result = await authentication.login({
        workspaceSlug: workspace.slug,
        email: definition.email,
        password: DEMO_SEED_PASSWORD,
        request: requestMetadata,
      });
      expect(result.context.roleKey).toBe(definition.roleKey);
      await expect(authentication.logout(result.token)).resolves.toBe(true);
    }
  }, 30_000);

  it("materializa equipes e a matriz básica de permissões", async () => {
    const workspace = await getWorkspace();
    const authentication = createAuthenticationService({
      database,
      sessionTtlHours: 8,
      maxFailedAttempts: 5,
      lockMinutes: 15,
    });
    const authorization = createAuthorizationService({ database });
    const contexts = new Map<string, Awaited<ReturnType<typeof authentication.login>>>();

    for (const definition of DEMO_USERS) {
      contexts.set(
        definition.key,
        await authentication.login({
          workspaceSlug: workspace.slug,
          email: definition.email,
          password: DEMO_SEED_PASSWORD,
          request: requestMetadata,
        }),
      );
    }

    const admin = contexts.get("admin")!.context;
    const manager = contexts.get("gestor")!.context;
    const sdr = contexts.get("sdr-1")!.context;
    const closer = contexts.get("closer-1")!.context;
    const viewer = contexts.get("viewer")!.context;
    await expect(
      authorization.authorize(admin, PermissionKeys.WORKSPACE_MANAGE, {
        workspaceId: workspace.id,
        resourceType: "Workspace",
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "WORKSPACE" });
    await expect(
      authorization.authorize(manager, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspace.id,
        resourceType: "Lead",
        ownerMemberId: sdr.memberId,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "TEAM" });
    await expect(
      authorization.authorize(sdr, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspace.id,
        resourceType: "Lead",
        ownerMemberId: sdr.memberId,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "OWN" });
    await expect(
      authorization.authorize(closer, PermissionKeys.OPPORTUNITIES_WRITE, {
        workspaceId: workspace.id,
        resourceType: "Opportunity",
        ownerMemberId: closer.memberId,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "OWN" });
    await expect(
      authorization.authorize(viewer, PermissionKeys.LEADS_READ, {
        workspaceId: workspace.id,
        resourceType: "Lead",
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "WORKSPACE" });
    await expect(
      authorization.authorize(viewer, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspace.id,
        resourceType: "Lead",
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "MISSING_PERMISSION" });

    for (const result of contexts.values()) {
      await authentication.logout(result.token);
    }
  }, 30_000);

  it("representa acesso inativo sem permitir login", async () => {
    const viewer = await database.user.findUniqueOrThrow({
      where: { normalizedEmail: "viewer@demo.politizai.local" },
      include: { memberships: { where: { workspace: { slug: DEMO_WORKSPACE_SLUG } } } },
    });
    const member = viewer.memberships[0];
    expect(member).toBeDefined();
    const authentication = createAuthenticationService({
      database,
      sessionTtlHours: 8,
      maxFailedAttempts: 5,
      lockMinutes: 15,
    });

    try {
      await database.workspaceMember.update({
        where: { id: member!.id },
        data: { status: "INACTIVE" },
      });
      await expect(
        authentication.login({
          workspaceSlug: DEMO_WORKSPACE_SLUG,
          email: viewer.normalizedEmail,
          password: DEMO_SEED_PASSWORD,
          request: requestMetadata,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    } finally {
      await database.workspaceMember.update({
        where: { id: member!.id },
        data: { status: "ACTIVE" },
      });
    }
  });

  it("preserva registro manual e personalização entre execuções", async () => {
    const workspace = await getWorkspace();
    const systemActor = await database.actor.findFirstOrThrow({
      where: { workspaceId: workspace.id, key: "system" },
    });
    const manualKey = `manual-preservation-${randomUUID()}`;
    const manualSource = await database.leadSource.create({
      data: {
        workspaceId: workspace.id,
        key: manualKey,
        name: "Origem criada manualmente",
        type: "OTHER",
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    });
    const product = await database.product.findFirstOrThrow({
      where: { workspaceId: workspace.id, sku: "DEMO-DIAGNOSTICO" },
    });
    const customizedName = `Diagnóstico personalizado ${randomUUID()}`;
    const customizedPrice = product.listPriceCents + 1n;
    await database.product.update({
      where: { id: product.id },
      data: { name: customizedName, listPriceCents: customizedPrice },
    });

    await seedDemoDatabase(database, localEnvironment);

    await expect(
      database.leadSource.findUnique({ where: { id: manualSource.id } }),
    ).resolves.toMatchObject({ key: manualKey, name: "Origem criada manualmente" });
    await expect(
      database.product.findUnique({ where: { id: product.id } }),
    ).resolves.toMatchObject({ name: customizedName, listPriceCents: customizedPrice });
  }, 30_000);
});
