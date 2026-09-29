import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { verifyPassword } from "@/modules/auth/domain/password";
import { createLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { chooseRoundRobinOwner } from "@/modules/leads/application/lead-routing";
import { createWorkspaceAdministrationService } from "@/modules/users/application/workspace-administration-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for administration integration tests.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 12 }),
});
const authorization = createAuthorizationService({ database });
const fixedNow = new Date("2037-06-15T15:00:00.000Z");
const distribution = createLeadDistributionService({
  database,
  authorization,
  now: () => fixedNow,
});

let workspaceId: string;
let workspaceSlug: string;
let otherWorkspaceId: string;
let systemActorId: string;
let generalQueueId: string;
let preSalesTeamId: string;
let salesTeamId: string;
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;
let pauseSdr: AuthenticatedContext;
let inactivateSdr: AuthenticatedContext;
let rollbackSdr: AuthenticatedContext;
let editSdr: AuthenticatedContext;
let managerSourceSdr: AuthenticatedContext;
let destinationSdr: AuthenticatedContext;
let outsideSdr: AuthenticatedContext;
let adminRoleId: string;
let sdrRoleId: string;
let closerRoleId: string;
let viewerRoleId: string;
let inactivateLeadId: string;
let rollbackLeadId: string;
let managerLeadId: string;
let historicalActivityId: string;

function contextFor(
  row: Readonly<{
    userId: string;
    memberId: string;
    actorId: string;
    roleId: string;
    roleKey: string;
    displayName: string;
  }>,
): AuthenticatedContext {
  return {
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug,
    userId: row.userId,
    memberId: row.memberId,
    actorId: row.actorId,
    roleId: row.roleId,
    roleKey: row.roleKey,
    roleName: row.roleKey,
    displayName: row.displayName,
  };
}

async function createRole(
  key: string,
  name: string,
  grants: ReadonlyArray<readonly [string, "WORKSPACE" | "TEAM" | "OWN"]>,
) {
  const role = await database.role.create({
    data: {
      workspaceId,
      key,
      name,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  for (const [permissionKey, scope] of grants) {
    const permission = await database.permission.upsert({
      where: { key: permissionKey },
      update: {},
      create: { key: permissionKey, description: permissionKey },
    });
    await database.rolePermission.create({
      data: {
        workspaceId,
        roleId: role.id,
        permissionId: permission.id,
        scope,
        createdByActorId: systemActorId,
      },
    });
  }
  return role.id;
}

async function createPerson(input: {
  label: string;
  roleId: string;
  roleKey: string;
  teamId?: string;
  function?: "SDR" | "CLOSER" | "MANAGER";
}) {
  const suffix = randomUUID();
  const user = await database.user.create({
    data: {
      email: `${input.label}.${suffix}@administration.test`,
      normalizedEmail: `${input.label}.${suffix}@administration.test`,
      displayName: input.label,
    },
  });
  const member = await database.workspaceMember.create({
    data: {
      workspaceId,
      userId: user.id,
      roleId: input.roleId,
      status: "ACTIVE",
      joinedAt: fixedNow,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  const actor = await database.actor.create({
    data: {
      workspaceId,
      userId: user.id,
      type: "HUMAN",
      key: `user:${user.id}`,
      displayName: input.label,
    },
  });
  if (input.teamId && input.function) {
    await database.teamMember.create({
      data: {
        workspaceId,
        teamId: input.teamId,
        workspaceMemberId: member.id,
        function: input.function,
        createdByActorId: systemActorId,
        updatedByActorId: systemActorId,
      },
    });
  }
  return contextFor({
    userId: user.id,
    memberId: member.id,
    actorId: actor.id,
    roleId: input.roleId,
    roleKey: input.roleKey,
    displayName: input.label,
  });
}

async function createOpenLead(ownerMemberId: string, label: string) {
  const source = await database.leadSource.findFirstOrThrow({
    where: { workspaceId, key: "manual" },
  });
  const pipeline = await database.pipeline.findFirstOrThrow({
    where: { workspaceId, entityType: "LEAD" },
    include: { stages: { take: 1, orderBy: { position: "asc" } } },
  });
  const lead = await database.lead.create({
    data: {
      workspaceId,
      sourceId: source.id,
      pipelineId: pipeline.id,
      currentStageId: pipeline.stages[0]!.id,
      ownerMemberId,
      routingQueueId: generalQueueId,
      fullName: label,
      normalizedPhone: `+55119${randomUUID().replace(/\D/g, "").padEnd(8, "1").slice(0, 8)}`,
      status: "OPEN",
      priority: "HIGH",
      slaStartedAt: fixedNow,
      slaDueAt: fixedNow,
      lastActivityAt: fixedNow,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  const task = await database.task.create({
    data: {
      workspaceId,
      leadId: lead.id,
      assigneeMemberId: ownerMemberId,
      title: "Retornar lead",
      kind: "FOLLOW_UP",
      status: "OPEN",
      priority: "HIGH",
      dueAt: fixedNow,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  await database.lead.update({
    where: { id: lead.id },
    data: {
      nextActionTaskId: task.id,
      nextActionAt: task.dueAt,
      nextActionDescription: task.title,
    },
  });
  return { leadId: lead.id, taskId: task.id };
}

function service(beforeCommit?: () => Promise<void>) {
  return createWorkspaceAdministrationService({
    database,
    authorization,
    distribution,
    now: () => fixedNow,
    ...(beforeCommit ? { beforeCommit } : {}),
  });
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const workspace = await database.workspace.create({
    data: { slug: `administration-${suffix}`, name: "Administração isolada" },
  });
  workspaceId = workspace.id;
  workspaceSlug = workspace.slug;
  const system = await database.actor.create({
    data: { workspaceId, type: "SYSTEM", key: "system", displayName: "Sistema" },
  });
  systemActorId = system.id;

  adminRoleId = await createRole("administrator", "Administrador", [
    [PermissionKeys.WORKSPACE_MEMBERS_MANAGE, "WORKSPACE"],
    [PermissionKeys.LEADS_ASSIGN, "WORKSPACE"],
    [PermissionKeys.LEADS_WRITE, "WORKSPACE"],
  ]);
  const managerRoleId = await createRole("commercial_manager", "Gestor", [
    [PermissionKeys.LEADS_ASSIGN, "TEAM"],
    [PermissionKeys.LEADS_WRITE, "TEAM"],
  ]);
  sdrRoleId = await createRole("sdr", "SDR", [
    [PermissionKeys.LEADS_WRITE, "OWN"],
  ]);
  closerRoleId = await createRole("closer", "Closer", []);
  viewerRoleId = await createRole("viewer", "Visualizador", []);

  const preSales = await database.team.create({
    data: {
      workspaceId,
      name: "Pré-vendas",
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  const sales = await database.team.create({
    data: {
      workspaceId,
      name: "Vendas",
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  preSalesTeamId = preSales.id;
  salesTeamId = sales.id;
  const queue = await database.queue.create({
    data: {
      workspaceId,
      teamId: preSalesTeamId,
      key: "general",
      name: "Fila Geral",
      isGeneral: true,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  generalQueueId = queue.id;
  await database.leadSource.create({
    data: {
      workspaceId,
      key: "manual",
      name: "Manual",
      type: "MANUAL",
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  const pipeline = await database.pipeline.create({
    data: {
      workspaceId,
      name: "Pré-vendas",
      entityType: "LEAD",
      isDefault: true,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  await database.pipelineStage.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      name: "Novo",
      position: 0,
      type: "OPEN",
      leadStageCode: "NEW",
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });

  admin = await createPerson({ label: "Admin", roleId: adminRoleId, roleKey: "administrator" });
  manager = await createPerson({ label: "Manager", roleId: managerRoleId, roleKey: "commercial_manager", teamId: preSalesTeamId, function: "MANAGER" });
  viewer = await createPerson({ label: "Viewer", roleId: viewerRoleId, roleKey: "viewer" });
  pauseSdr = await createPerson({ label: "Pause SDR", roleId: sdrRoleId, roleKey: "sdr", teamId: preSalesTeamId, function: "SDR" });
  inactivateSdr = await createPerson({ label: "Inactive SDR", roleId: sdrRoleId, roleKey: "sdr", teamId: preSalesTeamId, function: "SDR" });
  rollbackSdr = await createPerson({ label: "Rollback SDR", roleId: sdrRoleId, roleKey: "sdr", teamId: preSalesTeamId, function: "SDR" });
  editSdr = await createPerson({ label: "Edit SDR", roleId: sdrRoleId, roleKey: "sdr", teamId: preSalesTeamId, function: "SDR" });
  managerSourceSdr = await createPerson({ label: "Manager Source", roleId: sdrRoleId, roleKey: "sdr", teamId: preSalesTeamId, function: "SDR" });
  destinationSdr = await createPerson({ label: "Destination SDR", roleId: sdrRoleId, roleKey: "sdr", teamId: preSalesTeamId, function: "SDR" });
  outsideSdr = await createPerson({ label: "Outside SDR", roleId: sdrRoleId, roleKey: "sdr", teamId: salesTeamId, function: "SDR" });

  const inactiveArtifacts = await createOpenLead(inactivateSdr.memberId, "Lead para inativação");
  inactivateLeadId = inactiveArtifacts.leadId;
  historicalActivityId = (
    await database.activity.create({
      data: {
        workspaceId,
        leadId: inactivateLeadId,
        type: "NOTE",
        direction: "INTERNAL",
        result: "INFORMATION",
        subject: "Histórico autoral preservado",
        occurredAt: fixedNow,
        createdByActorId: inactivateSdr.actorId,
        updatedByActorId: inactivateSdr.actorId,
      },
    })
  ).id;
  rollbackLeadId = (await createOpenLead(rollbackSdr.memberId, "Lead para rollback")).leadId;
  managerLeadId = (await createOpenLead(managerSourceSdr.memberId, "Lead gerencial")).leadId;

  const otherWorkspace = await database.workspace.create({
    data: { slug: `administration-other-${suffix}`, name: "Outro workspace" },
  });
  otherWorkspaceId = otherWorkspace.id;
  const otherSystem = await database.actor.create({
    data: { workspaceId: otherWorkspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" },
  });
  const otherUser = await database.user.create({
    data: {
      email: `${suffix}@other.test`,
      normalizedEmail: `${suffix}@other.test`,
      displayName: "Outro usuário",
    },
  });
  const otherRole = await database.role.create({
    data: {
      workspaceId: otherWorkspace.id,
      key: "sdr",
      name: "SDR",
      createdByActorId: otherSystem.id,
      updatedByActorId: otherSystem.id,
    },
  });
  await database.workspaceMember.create({
    data: {
      workspaceId: otherWorkspace.id,
      userId: otherUser.id,
      roleId: otherRole.id,
      status: "ACTIVE",
      createdByActorId: otherSystem.id,
      updatedByActorId: otherSystem.id,
    },
  });
}, 30_000);

afterAll(async () => {
  await database.$disconnect();
});

describe("administração de usuários, equipes e disponibilidade", () => {
  it("lista indicadores e permissões no escopo correto", async () => {
    const adminScreen = await service().getScreen(admin);
    expect(adminScreen.capabilities).toMatchObject({
      canManageMembers: true,
      canManageTeams: true,
      accessScope: "WORKSPACE",
    });
    expect(adminScreen.summary.members).toBeGreaterThanOrEqual(10);
    expect(adminScreen.summary.openLeads).toBe(3);
    expect(adminScreen.members.find(({ id }) => id === pauseSdr.memberId)?.role.permissions).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: PermissionKeys.LEADS_WRITE, scope: "OWN" })]),
    );

    const managerScreen = await service().getScreen(manager);
    expect(managerScreen.capabilities).toMatchObject({
      canManageMembers: false,
      canRedistribute: true,
      accessScope: "TEAM",
    });
    expect(managerScreen.members.some(({ id }) => id === outsideSdr.memberId)).toBe(false);
    await expect(service().getScreen(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("cria usuário com senha protegida e auditoria sem segredo", async () => {
    const email = `created.${randomUUID()}@administration.test`;
    const password = "Senha#Local2026";
    const before = await database.workspaceMember.count({ where: { workspaceId } });
    const preview = await service().preview(admin, {
      action: "CREATE_MEMBER",
      displayName: "Usuário criado",
      email,
      password,
      roleId: sdrRoleId,
      teamAssignments: [{ teamId: preSalesTeamId, function: "SDR" }],
    });
    expect(preview.title).toBe("Criar usuário local");
    await expect(database.workspaceMember.count({ where: { workspaceId } })).resolves.toBe(before);

    const result = await service().apply(admin, {
      action: "CREATE_MEMBER",
      confirmed: true,
      displayName: "Usuário criado",
      email,
      password,
      roleId: sdrRoleId,
      teamAssignments: [{ teamId: preSalesTeamId, function: "SDR" }],
    });
    const created = result.members.find(({ email: value }) => value === email);
    expect(created).toMatchObject({ status: "ACTIVE", role: { id: sdrRoleId } });
    const credential = await database.localCredential.findFirstOrThrow({
      where: { user: { normalizedEmail: email } },
    });
    await expect(verifyPassword(password, credential.passwordHash)).resolves.toBe(true);
    expect(credential.passwordHash).not.toContain(password);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { workspaceId, entityId: created!.id, action: "workspace.member.created" },
    });
    expect(JSON.stringify(audit)).not.toContain(password);
  }, 20_000);

  it("edita perfil, papel e função comercial sem confundir os conceitos", async () => {
    const initial = (await service().getScreen(admin)).members.find(({ id }) => id === editSdr.memberId)!;
    const email = `edited.${randomUUID()}@administration.test`;
    const profiled = await service().apply(admin, {
      action: "UPDATE_MEMBER_PROFILE",
      confirmed: true,
      memberId: initial.id,
      expectedUpdatedAt: initial.updatedAt,
      displayName: "SDR editado",
      email,
    });
    const afterProfile = profiled.members.find(({ id }) => id === initial.id)!;
    const rerolled = await service().apply(admin, {
      action: "CHANGE_MEMBER_ROLE",
      confirmed: true,
      memberId: initial.id,
      expectedUpdatedAt: afterProfile.updatedAt,
      roleId: closerRoleId,
      reason: "Mudança de função acordada.",
    });
    const afterRole = rerolled.members.find(({ id }) => id === initial.id)!;
    const reteam = await service().apply(admin, {
      action: "SAVE_MEMBER_TEAMS",
      confirmed: true,
      memberId: initial.id,
      expectedUpdatedAt: afterRole.updatedAt,
      teamAssignments: [{ teamId: salesTeamId, function: "CLOSER" }],
    });
    expect(reteam.members.find(({ id }) => id === initial.id)).toMatchObject({
      displayName: "SDR editado",
      email,
      role: { id: closerRoleId },
      teamAssignments: [expect.objectContaining({ teamId: salesTeamId, function: "CLOSER" })],
    });
    await expect(database.auditLog.count({
      where: {
        workspaceId,
        entityId: initial.id,
        action: { in: ["workspace.member.profile.updated", "workspace.member.role.changed", "workspace.member.teams.changed"] },
      },
    })).resolves.toBe(3);
  });

  it("impede autoalteração de papel e mutação administrativa pelo gestor", async () => {
    const adminRow = (await service().getScreen(admin)).members.find(({ id }) => id === admin.memberId)!;
    await expect(service().apply(admin, {
      action: "CHANGE_MEMBER_ROLE",
      confirmed: true,
      memberId: admin.memberId,
      expectedUpdatedAt: adminRow.updatedAt,
      roleId: viewerRoleId,
      reason: "Tentativa de autoalteração.",
    })).rejects.toMatchObject({ code: "SELF_ROLE_CHANGE_FORBIDDEN" });
    const target = (await service().getScreen(manager)).members.find(({ id }) => id === pauseSdr.memberId)!;
    await expect(service().apply(manager, {
      action: "CHANGE_MEMBER_ROLE",
      confirmed: true,
      memberId: target.id,
      expectedUpdatedAt: target.updatedAt,
      roleId: adminRoleId,
      reason: "Tentativa sem autorização.",
    })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("pausa SDR e o round-robin reage à disponibilidade", async () => {
    await service().apply(manager, {
      action: "SET_MEMBER_RECEIVING_PAUSE",
      confirmed: true,
      memberId: pauseSdr.memberId,
      paused: true,
      reason: "Ausência temporária.",
    });
    const owner = await database.$transaction((transaction) =>
      chooseRoundRobinOwner(transaction, {
        workspaceId,
        queueId: generalQueueId,
        teamId: preSalesTeamId,
        actorId: systemActorId,
        routedAt: fixedNow,
      }),
    );
    expect(owner.type).toBe("MEMBER");
    expect(owner.memberId).not.toBe(pauseSdr.memberId);
    await expect(database.auditLog.count({
      where: { workspaceId, entityId: pauseSdr.memberId, action: "lead.receiving.paused" },
    })).resolves.toBe(1);
  });

  it("inativa, revoga sessão e redistribui lead e tarefas sem apagar autoria", async () => {
    await database.authSession.create({
      data: {
        workspaceId,
        userId: inactivateSdr.userId,
        workspaceMemberId: inactivateSdr.memberId,
        actorId: inactivateSdr.actorId,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        credentialVersion: 1,
        expiresAt: new Date("2038-01-01T00:00:00.000Z"),
      },
    });
    const row = (await service().getScreen(admin)).members.find(({ id }) => id === inactivateSdr.memberId)!;
    await service().apply(admin, {
      action: "SET_MEMBER_STATUS",
      confirmed: true,
      memberId: row.id,
      expectedUpdatedAt: row.updatedAt,
      status: "INACTIVE",
      reason: "Usuário desligado da operação.",
      redistributionTarget: { type: "GENERAL_QUEUE" },
    });
    await expect(database.workspaceMember.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({ status: "INACTIVE", deletedAt: null });
    await expect(database.lead.findUniqueOrThrow({ where: { id: inactivateLeadId } })).resolves.toMatchObject({ ownerMemberId: null, queueId: generalQueueId });
    await expect(database.task.findFirstOrThrow({ where: { workspaceId, leadId: inactivateLeadId, status: "OPEN" } })).resolves.toMatchObject({ assigneeMemberId: null, queueId: generalQueueId });
    await expect(database.authSession.findFirstOrThrow({ where: { workspaceMemberId: row.id } })).resolves.toMatchObject({ revokedAt: fixedNow });
    await expect(database.activity.findUniqueOrThrow({ where: { id: historicalActivityId } })).resolves.toMatchObject({ createdByActorId: inactivateSdr.actorId });
    await expect(database.auditLog.count({ where: { workspaceId, entityId: row.id, action: "workspace.member.inactivated" } })).resolves.toBe(1);
  });

  it("reverte status, lead, tarefa e auditoria quando a transação falha", async () => {
    const row = (await service().getScreen(admin)).members.find(({ id }) => id === rollbackSdr.memberId)!;
    await expect(service(async () => {
      throw new Error("forced administration rollback");
    }).apply(admin, {
      action: "SET_MEMBER_STATUS",
      confirmed: true,
      memberId: row.id,
      expectedUpdatedAt: row.updatedAt,
      status: "INACTIVE",
      reason: "Teste de rollback integral.",
      redistributionTarget: { type: "GENERAL_QUEUE" },
    })).rejects.toThrow("forced administration rollback");
    await expect(database.workspaceMember.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(database.lead.findUniqueOrThrow({ where: { id: rollbackLeadId } })).resolves.toMatchObject({ ownerMemberId: rollbackSdr.memberId, queueId: null });
    await expect(database.auditLog.count({ where: { workspaceId, entityId: row.id, action: "workspace.member.inactivated" } })).resolves.toBe(0);
  });

  it("permite redistribuição gerencial apenas dentro do escopo da equipe", async () => {
    await service().apply(manager, {
      action: "REDISTRIBUTE_MEMBER_LEADS",
      confirmed: true,
      memberId: managerSourceSdr.memberId,
      target: { type: "MEMBER", memberId: destinationSdr.memberId },
      reason: "Balanceamento de carga da equipe.",
    });
    await expect(database.lead.findUniqueOrThrow({ where: { id: managerLeadId } })).resolves.toMatchObject({ ownerMemberId: destinationSdr.memberId, queueId: null });
    await expect(service().preview(manager, {
      action: "REDISTRIBUTE_MEMBER_LEADS",
      memberId: outsideSdr.memberId,
      target: { type: "GENERAL_QUEUE" },
      reason: "Tentativa fora da equipe.",
    })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("isola recursos de outro workspace e gerencia equipes com auditoria", async () => {
    const foreign = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: otherWorkspaceId } });
    await expect(service().preview(admin, {
      action: "SET_MEMBER_STATUS",
      memberId: foreign.id,
      expectedUpdatedAt: foreign.updatedAt.toISOString(),
      status: "INACTIVE",
      reason: "Tentativa cruzada.",
      redistributionTarget: { type: "GENERAL_QUEUE" },
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const created = await service().apply(admin, {
      action: "SAVE_TEAM",
      confirmed: true,
      id: null,
      expectedUpdatedAt: null,
      name: "Parcerias",
      description: "Equipe criada pelo teste.",
    });
    const team = created.teams.find(({ name }) => name === "Parcerias")!;
    const edited = await service().apply(admin, {
      action: "SAVE_TEAM",
      confirmed: true,
      id: team.id,
      expectedUpdatedAt: team.updatedAt,
      name: "Parcerias estratégicas",
      description: null,
    });
    expect(edited.teams.find(({ id }) => id === team.id)).toMatchObject({ name: "Parcerias estratégicas", description: null });
    await expect(database.auditLog.count({ where: { workspaceId, entityId: team.id, action: { in: ["workspace.team.created", "workspace.team.updated"] } } })).resolves.toBe(2);
  });
});
