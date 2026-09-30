import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  createAuthenticationService,
  hashSessionToken,
} from "@/modules/auth/application/authentication-service";
import { resolveServiceActorContext } from "@/modules/auth/application/service-actor-context";
import {
  AuthenticationRequiredError,
  InvalidCredentialsError,
  SessionExpiredError,
} from "@/modules/auth/domain/auth-errors";
import { hashPassword } from "@/modules/auth/domain/password";
import { SESSION_COOKIE_NAME } from "@/modules/auth/http/session-cookie";
import { createWorkspaceAdministrationService } from "@/modules/users/application/workspace-administration-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import {
  PermissionKeys,
  permissionCatalog,
  AccessRoleKeys,
  type PermissionKey,
} from "@/modules/users/permissions/permission-keys";
import { PrismaClient, type PermissionScope } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/shared/core/database/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for auth integration tests.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 5 }),
});
const password = "Senha-local-segura-123";
const requestMetadata = Object.freeze({
  ipAddress: "127.0.0.1",
  userAgent: "vitest",
});

type AccessRole =
  (typeof AccessRoleKeys)[keyof typeof AccessRoleKeys];
type MemberKey = "administrator" | "manager" | "sdr" | "closer" | "viewer" | "outsideSdr";
type FixtureMember = Readonly<{
  id: string;
  userId: string;
  actorId: string;
  roleId: string;
  roleKey: AccessRole;
  email: string;
  displayName: string;
}>;

type WorkspaceFixture = Readonly<{
  id: string;
  slug: string;
  systemActorId: string;
  automationActorId: string;
  aiActorId: string;
  roles: Record<AccessRole, string>;
  members: Record<MemberKey, FixtureMember>;
  salesTeamId: string;
  otherTeamId: string;
  salesQueueId: string;
}>;

const roleGrants: Record<
  AccessRole,
  ReadonlyArray<readonly [PermissionKey, PermissionScope]>
> = {
  administrator: permissionCatalog.map(({ key }) => [key, "WORKSPACE"]),
  commercial_manager: [
    [PermissionKeys.LEADS_READ, "TEAM"],
    [PermissionKeys.LEADS_WRITE, "TEAM"],
    [PermissionKeys.LEADS_ASSIGN, "TEAM"],
    [PermissionKeys.BULK_ACTIONS_EXECUTE, "TEAM"],
    [PermissionKeys.EXPORTS_EXECUTE, "TEAM"],
    [PermissionKeys.MEETINGS_READ, "TEAM"],
    [PermissionKeys.MEETINGS_WRITE, "TEAM"],
    [PermissionKeys.OPPORTUNITIES_READ, "TEAM"],
    [PermissionKeys.OPPORTUNITIES_WRITE, "TEAM"],
  ],
  sdr: [
    [PermissionKeys.LEADS_READ, "OWN"],
    [PermissionKeys.LEADS_WRITE, "OWN"],
    [PermissionKeys.TASKS_READ, "OWN"],
    [PermissionKeys.TASKS_WRITE, "OWN"],
    [PermissionKeys.MEETINGS_READ, "OWN"],
    [PermissionKeys.MEETINGS_WRITE, "OWN"],
  ],
  closer: [
    [PermissionKeys.MEETINGS_READ, "OWN"],
    [PermissionKeys.MEETINGS_WRITE, "OWN"],
    [PermissionKeys.OPPORTUNITIES_READ, "OWN"],
    [PermissionKeys.OPPORTUNITIES_WRITE, "OWN"],
  ],
  viewer: [
    [PermissionKeys.LEADS_READ, "WORKSPACE"],
    [PermissionKeys.TASKS_READ, "WORKSPACE"],
    [PermissionKeys.MEETINGS_READ, "WORKSPACE"],
    [PermissionKeys.OPPORTUNITIES_READ, "WORKSPACE"],
  ],
};

async function createWorkspaceFixture(prefix: string): Promise<WorkspaceFixture> {
  const suffix = randomUUID().slice(0, 8);
  const workspace = await database.workspace.create({
    data: { name: `${prefix} ${suffix}`, slug: `${prefix}-${suffix}`.toLowerCase() },
  });
  const systemActor = await database.actor.create({
    data: {
      workspaceId: workspace.id,
      type: "SYSTEM",
      key: "system",
      displayName: "Sistema",
    },
  });
  const [automationActor, aiActor] = await Promise.all([
    database.actor.create({
      data: {
        workspaceId: workspace.id,
        type: "AUTOMATION",
        key: "automation:local",
        displayName: "Automação local",
      },
    }),
    database.actor.create({
      data: {
        workspaceId: workspace.id,
        type: "AI_AGENT",
        key: "ai:recommendation",
        displayName: "Agente de recomendação",
      },
    }),
  ]);

  const permissions = new Map<string, string>();
  for (const entry of permissionCatalog) {
    const permission = await database.permission.upsert({
      where: { key: entry.key },
      update: { description: entry.description },
      create: { key: entry.key, description: entry.description },
    });
    permissions.set(entry.key, permission.id);
  }

  const roles = {} as Record<AccessRole, string>;
  for (const roleKey of Object.keys(roleGrants) as AccessRole[]) {
    const role = await database.role.create({
      data: {
        workspaceId: workspace.id,
        key: roleKey,
        name: roleKey,
        isSystem: true,
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    });
    roles[roleKey] = role.id;
    await database.rolePermission.createMany({
      data: roleGrants[roleKey].map(([permissionKey, scope]) => ({
        workspaceId: workspace.id,
        roleId: role.id,
        permissionId: permissions.get(permissionKey)!,
        scope,
        createdByActorId: systemActor.id,
      })),
    });
  }

  const sharedPasswordHash = await hashPassword(password);
  async function createMember(
    key: MemberKey,
    roleKey: AccessRole,
  ): Promise<FixtureMember> {
    const email = `${prefix}.${key}.${suffix}@example.test`.toLowerCase();
    const user = await database.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: `${prefix} ${key}`,
        credential: { create: { passwordHash: sharedPasswordHash } },
      },
    });
    const member = await database.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        roleId: roles[roleKey],
        status: "ACTIVE",
        joinedAt: new Date(),
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    });
    const actor = await database.actor.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        type: "HUMAN",
        key: `user:${user.id}`,
        displayName: user.displayName,
      },
    });
    return {
      id: member.id,
      userId: user.id,
      actorId: actor.id,
      roleId: roles[roleKey],
      roleKey,
      email,
      displayName: user.displayName,
    };
  }

  const members = {
    administrator: await createMember("administrator", "administrator"),
    manager: await createMember("manager", "commercial_manager"),
    sdr: await createMember("sdr", "sdr"),
    closer: await createMember("closer", "closer"),
    viewer: await createMember("viewer", "viewer"),
    outsideSdr: await createMember("outsideSdr", "sdr"),
  };
  const [salesTeam, otherTeam] = await Promise.all([
    database.team.create({
      data: {
        workspaceId: workspace.id,
        name: "Equipe comercial",
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    }),
    database.team.create({
      data: {
        workspaceId: workspace.id,
        name: "Outra equipe",
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    }),
  ]);
  await database.teamMember.createMany({
    data: [
      [members.manager, "MANAGER", salesTeam.id],
      [members.sdr, "SDR", salesTeam.id],
      [members.closer, "CLOSER", salesTeam.id],
      [members.outsideSdr, "SDR", otherTeam.id],
    ].map(([member, teamFunction, teamId]) => ({
      workspaceId: workspace.id,
      teamId: teamId as string,
      workspaceMemberId: (member as FixtureMember).id,
      function: teamFunction as "MANAGER" | "SDR" | "CLOSER",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    })),
  });
  const salesQueue = await database.queue.create({
    data: {
      workspaceId: workspace.id,
      teamId: salesTeam.id,
      key: "sales",
      name: "Fila comercial",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });

  return {
    id: workspace.id,
    slug: workspace.slug,
    systemActorId: systemActor.id,
    automationActorId: automationActor.id,
    aiActorId: aiActor.id,
    roles,
    members,
    salesTeamId: salesTeam.id,
    otherTeamId: otherTeam.id,
    salesQueueId: salesQueue.id,
  };
}

function contextFor(
  fixture: WorkspaceFixture,
  member: FixtureMember,
): AuthenticatedContext {
  return Object.freeze({
    sessionId: randomUUID(),
    workspaceId: fixture.id,
    workspaceSlug: fixture.slug,
    userId: member.userId,
    memberId: member.id,
    actorId: member.actorId,
    roleId: member.roleId,
    roleKey: member.roleKey,
    roleName: member.roleKey,
    displayName: member.displayName,
  });
}

describe("autenticação local, RBAC e isolamento", () => {
  let workspaceA: WorkspaceFixture;
  let workspaceB: WorkspaceFixture;
  const authorization = createAuthorizationService({ database });

  beforeAll(async () => {
    workspaceA = await createWorkspaceFixture("auth-a");
    workspaceB = await createWorkspaceFixture("auth-b");
  });

  afterAll(async () => {
    await Promise.all([database.$disconnect(), getDatabaseClient().$disconnect()]);
  });

  it("executa login, consulta de sessão e logout pelos adaptadores HTTP", async () => {
    const member = workspaceA.members.administrator;
    const loginResponse = await loginRoute(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          workspace: workspaceA.slug,
          email: member.email,
          password,
        }),
      }),
    );
    const token = loginResponse.cookies.get(SESSION_COOKIE_NAME)?.value;

    expect(loginResponse.status).toBe(200);
    expect(token).toBeTruthy();

    const sessionResponse = await sessionRoute(
      new NextRequest("http://localhost:3000/api/auth/session", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
    );
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      session: {
        user: {
          id: member.userId,
          permissionKeys: expect.arrayContaining([
            PermissionKeys.FINANCE_READ,
            PermissionKeys.METRICS_READ,
          ]),
        },
        workspace: { id: workspaceA.id },
      },
    });

    const logoutResponse = await logoutRoute(
      new NextRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          origin: "http://localhost:3000",
        },
      }),
    );
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("");

    const revokedSessionResponse = await sessionRoute(
      new NextRequest("http://localhost:3000/api/auth/session", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
    );
    expect(revokedSessionResponse.status).toBe(401);
  });

  it("autentica com senha válida, não persiste o token aberto e audita falhas", async () => {
    const authentication = createAuthenticationService({
      database,
      sessionTtlHours: 8,
      maxFailedAttempts: 5,
      lockMinutes: 15,
    });
    const member = workspaceA.members.sdr;

    await expect(
      authentication.login({
        workspaceSlug: workspaceA.slug,
        email: member.email,
        password: "senha-incorreta",
        request: requestMetadata,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const result = await authentication.login({
      workspaceSlug: workspaceA.slug,
      email: member.email.toUpperCase(),
      password,
      request: requestMetadata,
    });
    const storedSession = await database.authSession.findUniqueOrThrow({
      where: { id: result.context.sessionId },
    });
    const credential = await database.localCredential.findUniqueOrThrow({
      where: { userId: member.userId },
    });

    expect(result.context.workspaceId).toBe(workspaceA.id);
    expect(storedSession.tokenHash).toBe(hashSessionToken(result.token));
    expect(storedSession.tokenHash).not.toBe(result.token);
    expect(credential.failedAttempts).toBe(0);
    expect(
      await database.auditLog.count({
        where: {
          workspaceId: workspaceA.id,
          action: { in: ["auth.login.failed", "auth.login.succeeded"] },
        },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("encerra a sessão, invalida reuso e registra logout", async () => {
    const authentication = createAuthenticationService({
      database,
      sessionTtlHours: 8,
      maxFailedAttempts: 5,
      lockMinutes: 15,
    });
    const result = await authentication.login({
      workspaceSlug: workspaceA.slug,
      email: workspaceA.members.closer.email,
      password,
      request: requestMetadata,
    });

    await expect(authentication.validateSession(result.token)).resolves.toMatchObject({
      userId: workspaceA.members.closer.userId,
    });
    await expect(authentication.logout(result.token)).resolves.toBe(true);
    await expect(authentication.validateSession(result.token)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    await expect(authentication.logout(result.token)).resolves.toBe(false);
    expect(
      await database.auditLog.count({
        where: { entityId: result.context.sessionId, action: "auth.logout" },
      }),
    ).toBe(1);
  });

  it("expira a sessão no servidor e trata token ausente", async () => {
    let clock = new Date("2030-01-01T10:00:00.000Z");
    const authentication = createAuthenticationService({
      database,
      sessionTtlHours: 1,
      maxFailedAttempts: 5,
      lockMinutes: 15,
      now: () => clock,
    });
    const result = await authentication.login({
      workspaceSlug: workspaceA.slug,
      email: workspaceA.members.viewer.email,
      password,
      request: requestMetadata,
    });
    clock = new Date("2030-01-01T11:00:00.001Z");

    await expect(authentication.validateSession(result.token)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    await expect(authentication.validateSession(undefined)).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
    expect(
      await database.auditLog.count({
        where: {
          entityId: result.context.sessionId,
          action: "auth.session.expired",
        },
      }),
    ).toBe(1);
  });

  it("impede acesso cruzado por workspace antes de avaliar o recurso", async () => {
    const context = contextFor(workspaceA, workspaceA.members.administrator);
    const decision = await authorization.authorize(
      context,
      PermissionKeys.WORKSPACE_MANAGE,
      { workspaceId: workspaceB.id, resourceType: "Workspace" },
    );

    expect(decision).toEqual({
      allowed: false,
      reason: "WORKSPACE_MISMATCH",
      contextIsValid: true,
    });
    await expect(
      authorization.assertAuthorized(context, PermissionKeys.WORKSPACE_MANAGE, {
        workspaceId: workspaceB.id,
        resourceType: "Workspace",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("aplica a matriz de papel e escopo de equipe ou responsável", async () => {
    const manager = contextFor(workspaceA, workspaceA.members.manager);
    const sdr = contextFor(workspaceA, workspaceA.members.sdr);
    const closer = contextFor(workspaceA, workspaceA.members.closer);
    const viewer = contextFor(workspaceA, workspaceA.members.viewer);

    await expect(
      authorization.authorize(manager, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspaceA.id,
        resourceType: "Lead",
        ownerMemberId: workspaceA.members.sdr.id,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "TEAM" });
    await expect(
      authorization.authorize(manager, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspaceA.id,
        resourceType: "Lead",
        ownerMemberId: workspaceA.members.outsideSdr.id,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "OUTSIDE_SCOPE" });
    await expect(
      authorization.authorize(sdr, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspaceA.id,
        resourceType: "Lead",
        ownerMemberId: workspaceA.members.sdr.id,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "OWN" });
    await expect(
      authorization.authorize(sdr, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspaceA.id,
        resourceType: "Lead",
        queueId: workspaceA.salesQueueId,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "OUTSIDE_SCOPE" });
    await expect(
      authorization.authorize(sdr, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspaceA.id,
        resourceType: "Lead",
        ownerMemberId: workspaceA.members.outsideSdr.id,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "OUTSIDE_SCOPE" });
    await expect(
      authorization.authorize(closer, PermissionKeys.OPPORTUNITIES_WRITE, {
        workspaceId: workspaceA.id,
        resourceType: "Opportunity",
        ownerMemberId: closer.memberId,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "OWN" });
    await expect(
      authorization.authorize(viewer, PermissionKeys.LEADS_READ, {
        workspaceId: workspaceA.id,
        resourceType: "Lead",
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "WORKSPACE" });
    await expect(
      authorization.authorize(viewer, PermissionKeys.LEADS_WRITE, {
        workspaceId: workspaceA.id,
        resourceType: "Lead",
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "MISSING_PERMISSION" });

    await expect(
      authorization.authorize(manager, PermissionKeys.BULK_ACTIONS_EXECUTE, {
        workspaceId: workspaceA.id,
        resourceType: "OpportunityBulk",
        memberId: manager.memberId,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "TEAM" });
    await expect(
      authorization.authorize(sdr, PermissionKeys.BULK_ACTIONS_EXECUTE, {
        workspaceId: workspaceA.id,
        resourceType: "LeadBulk",
        memberId: sdr.memberId,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "MISSING_PERMISSION" });
    await expect(
      authorization.authorize(closer, PermissionKeys.EXPORTS_EXECUTE, {
        workspaceId: workspaceA.id,
        resourceType: "CommercialExport",
        memberId: closer.memberId,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "MISSING_PERMISSION" });
  });

  it("nega dimensões de origem, negócio e canal fora do recurso autorizado", async () => {
    const context = contextFor(workspaceA, workspaceA.members.administrator);
    const [sourceA, sourceB] = await Promise.all([
      database.leadSource.create({
        data: {
          workspaceId: workspaceA.id,
          key: `source-${randomUUID()}`,
          name: "Origem workspace A",
          type: "MANUAL",
          createdByActorId: workspaceA.systemActorId,
          updatedByActorId: workspaceA.systemActorId,
        },
      }),
      database.leadSource.create({
        data: {
          workspaceId: workspaceB.id,
          key: `source-${randomUUID()}`,
          name: "Origem workspace B",
          type: "MANUAL",
          createdByActorId: workspaceB.systemActorId,
          updatedByActorId: workspaceB.systemActorId,
        },
      }),
    ]);
    const conversation = await database.conversation.create({
      data: {
        workspaceId: workspaceA.id,
        queueId: workspaceA.salesQueueId,
        channel: "EMAIL",
        createdByActorId: workspaceA.systemActorId,
        updatedByActorId: workspaceA.systemActorId,
      },
    });

    await expect(
      authorization.authorize(context, PermissionKeys.LEADS_READ, {
        workspaceId: workspaceA.id,
        resourceType: "LeadSource",
        sourceId: sourceA.id,
      }),
    ).resolves.toMatchObject({ allowed: true, scope: "WORKSPACE" });
    await expect(
      authorization.authorize(context, PermissionKeys.LEADS_READ, {
        workspaceId: workspaceA.id,
        resourceType: "LeadSource",
        sourceId: sourceB.id,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "RESOURCE_DIMENSION_MISMATCH" });
    await expect(
      authorization.authorize(context, PermissionKeys.OPPORTUNITIES_READ, {
        workspaceId: workspaceA.id,
        resourceType: "Opportunity",
        opportunityId: randomUUID(),
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "RESOURCE_DIMENSION_MISMATCH" });
    await expect(
      authorization.authorize(context, PermissionKeys.INBOX_READ, {
        workspaceId: workspaceA.id,
        resourceType: "Conversation",
        resourceId: conversation.id,
        channel: "WHATSAPP",
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "RESOURCE_DIMENSION_MISMATCH" });
  });

  it("autoriza administração somente no servidor e audita a alteração", async () => {
    const administration = createWorkspaceAdministrationService({
      database,
      authorization,
    });
    const target = workspaceA.members.outsideSdr;

    await expect(
      administration.changeMemberRole(
        contextFor(workspaceA, workspaceA.members.viewer),
        {
          workspaceId: workspaceA.id,
          memberId: target.id,
          roleId: workspaceA.roles.closer,
        },
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(
      await database.workspaceMember.findUniqueOrThrow({ where: { id: target.id } }),
    ).toMatchObject({ roleId: target.roleId });

    await expect(
      administration.changeMemberRole(
        contextFor(workspaceA, workspaceA.members.administrator),
        {
          workspaceId: workspaceA.id,
          memberId: target.id,
          roleId: workspaceA.roles.closer,
        },
      ),
    ).resolves.toEqual({ memberId: target.id, roleId: workspaceA.roles.closer });
    expect(
      await database.auditLog.count({
        where: { entityId: target.id, action: "workspace.member.role.changed" },
      }),
    ).toBe(1);
  });

  it("representa Sistema, Automação e Agente de IA como atores sem login", async () => {
    await expect(
      resolveServiceActorContext(
        workspaceA.id,
        workspaceA.automationActorId,
        "AUTOMATION",
        database,
      ),
    ).resolves.toMatchObject({ actorType: "AUTOMATION" });
    await expect(
      resolveServiceActorContext(
        workspaceA.id,
        workspaceA.aiActorId,
        "AI_AGENT",
        database,
      ),
    ).resolves.toMatchObject({ actorType: "AI_AGENT" });

    const member = workspaceA.members.sdr;
    await expect(
      database.authSession.create({
        data: {
          workspaceId: workspaceA.id,
          userId: member.userId,
          workspaceMemberId: member.id,
          actorId: workspaceA.systemActorId,
          tokenHash: "f".repeat(64),
          credentialVersion: 1,
          createdAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });
});
