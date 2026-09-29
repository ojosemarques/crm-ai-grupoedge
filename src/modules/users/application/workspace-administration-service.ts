import type {
  PermissionScope,
  Prisma,
  PrismaClient,
  TeamFunction,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { hashPassword } from "@/modules/auth/domain/password";
import { reassignLeadInTransaction } from "@/modules/leads/application/lead-assignment-operation";
import { getLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import type {
  AdministrationMember,
  AdministrationRole,
  AdministrationTeam,
  WorkspaceAdministrationPreview,
  WorkspaceAdministrationScreen,
} from "@/modules/users/domain/workspace-administration-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permission: PermissionKey,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permission: PermissionKey,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type DistributionPort = Readonly<{
  setReceivingPause: ReturnType<
    typeof getLeadDistributionService
  >["setReceivingPause"];
}>;

type AdministrationServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  distribution?: DistributionPort;
  now?: () => Date;
  beforeCommit?: () => Promise<void>;
}>;

const idSchema = z.string().uuid();
const expectedAtSchema = z.string().datetime({ offset: true });
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const teamFunctionSchema = z.enum([
  "SDR",
  "CLOSER",
  "MANAGER",
  "ADMINISTRATOR",
  "SUPPORT",
]);
const confirmation = { confirmed: z.boolean().optional().default(false) };
const teamAssignmentsSchema = z
  .array(
    z
      .object({ teamId: idSchema, function: teamFunctionSchema })
      .strict(),
  )
  .max(20)
  .superRefine((assignments, context) => {
    if (new Set(assignments.map(({ teamId }) => teamId)).size !== assignments.length) {
      context.addIssue({
        code: "custom",
        message: "Uma equipe foi informada mais de uma vez.",
      });
    }
  });
const redistributionTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GENERAL_QUEUE") }).strict(),
  z.object({ type: z.literal("MEMBER"), memberId: idSchema }).strict(),
]);

const createMemberCommand = z
  .object({
    action: z.literal("CREATE_MEMBER"),
    ...confirmation,
    displayName: z.string().trim().min(2).max(160),
    email: emailSchema,
    password: z.string().min(12).max(128),
    roleId: idSchema,
    teamAssignments: teamAssignmentsSchema,
  })
  .strict();
const updateMemberProfileCommand = z
  .object({
    action: z.literal("UPDATE_MEMBER_PROFILE"),
    ...confirmation,
    memberId: idSchema,
    expectedUpdatedAt: expectedAtSchema,
    displayName: z.string().trim().min(2).max(160),
    email: emailSchema,
  })
  .strict();
const changeMemberRoleCommand = z
  .object({
    action: z.literal("CHANGE_MEMBER_ROLE"),
    ...confirmation,
    memberId: idSchema,
    expectedUpdatedAt: expectedAtSchema,
    roleId: idSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const setMemberStatusCommand = z
  .object({
    action: z.literal("SET_MEMBER_STATUS"),
    ...confirmation,
    memberId: idSchema,
    expectedUpdatedAt: expectedAtSchema,
    status: z.enum(["ACTIVE", "INACTIVE"]),
    reason: z.string().trim().min(3).max(500),
    redistributionTarget: redistributionTargetSchema.nullable(),
  })
  .strict();
const pauseMemberCommand = z
  .object({
    action: z.literal("SET_MEMBER_RECEIVING_PAUSE"),
    ...confirmation,
    memberId: idSchema,
    paused: z.boolean(),
    reason: z.string().trim().min(3).max(500).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.paused && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Informe o motivo da pausa.",
      });
    }
  });
const saveMemberTeamsCommand = z
  .object({
    action: z.literal("SAVE_MEMBER_TEAMS"),
    ...confirmation,
    memberId: idSchema,
    expectedUpdatedAt: expectedAtSchema,
    teamAssignments: teamAssignmentsSchema,
  })
  .strict();
const saveTeamCommand = z
  .object({
    action: z.literal("SAVE_TEAM"),
    ...confirmation,
    id: idSchema.nullable(),
    expectedUpdatedAt: expectedAtSchema.nullable(),
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2_000).nullable(),
  })
  .strict();
const redistributeMemberLeadsCommand = z
  .object({
    action: z.literal("REDISTRIBUTE_MEMBER_LEADS"),
    ...confirmation,
    memberId: idSchema,
    target: redistributionTargetSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const workspaceAdministrationCommandSchema = z.discriminatedUnion(
  "action",
  [
    createMemberCommand,
    updateMemberProfileCommand,
    changeMemberRoleCommand,
    setMemberStatusCommand,
    pauseMemberCommand,
    saveMemberTeamsCommand,
    saveTeamCommand,
    redistributeMemberLeadsCommand,
  ],
);
export type WorkspaceAdministrationCommand = z.infer<
  typeof workspaceAdministrationCommandSchema
>;

type AdministrationAccess = Readonly<{
  canManageMembers: boolean;
  canManageTeams: boolean;
  canRedistribute: boolean;
  accessScope: "WORKSPACE" | "TEAM";
  teamIds: readonly string[];
}>;

function invalidInput(error: z.ZodError | string): never {
  throw new ApplicationError(
    typeof error === "string"
      ? error
      : error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function notFound(message: string): never {
  throw new ApplicationError(message, {
    code: "NOT_FOUND",
    statusCode: 404,
    expose: true,
  });
}

function conflict(code: string, message: string): never {
  throw new ApplicationError(message, {
    code,
    statusCode: 409,
    expose: true,
  });
}

function parseCommand(input: unknown): WorkspaceAdministrationCommand {
  const parsed = workspaceAdministrationCommandSchema.safeParse(input);
  if (!parsed.success) invalidInput(parsed.error);
  return parsed.data;
}

function targetMemberId(
  target: z.infer<typeof redistributionTargetSchema>,
): string | null {
  return target.type === "MEMBER" ? target.memberId : null;
}

function countMap(
  rows: ReadonlyArray<Readonly<{ ownerMemberId: string | null; _count: { _all: number } }>>,
): Map<string, number> {
  return new Map(
    rows.flatMap((row) =>
      row.ownerMemberId ? [[row.ownerMemberId, row._count._all] as const] : [],
    ),
  );
}

function permissionScope(decision: AuthorizationDecision): PermissionScope | null {
  return decision.allowed ? decision.scope : null;
}

export function createWorkspaceAdministrationService(
  options: AdministrationServiceOptions,
) {
  const distribution = options.distribution ?? getLeadDistributionService();
  const clock = options.now ?? (() => new Date());
  const workspaceResource = (workspaceId: string): ResourceScope => ({
    workspaceId,
    resourceType: "WorkspaceAdministration",
    resourceId: workspaceId,
  });

  async function resolveAccess(
    context: AuthenticatedContext,
  ): Promise<AdministrationAccess> {
    const manageDecision = await options.authorization.authorize(
      context,
      PermissionKeys.WORKSPACE_MEMBERS_MANAGE,
      workspaceResource(context.workspaceId),
    );
    if (permissionScope(manageDecision) === "WORKSPACE") {
      return {
        canManageMembers: true,
        canManageTeams: true,
        canRedistribute: true,
        accessScope: "WORKSPACE",
        teamIds: [],
      };
    }

    const memberships = await options.database.teamMember.findMany({
      where: {
        workspaceId: context.workspaceId,
        workspaceMemberId: context.memberId,
        deletedAt: null,
        team: { deletedAt: null },
      },
      select: { teamId: true },
    });
    const teamIds = [...new Set(memberships.map(({ teamId }) => teamId))];
    for (const teamId of teamIds) {
      const decision = await options.authorization.authorize(
        context,
        PermissionKeys.LEADS_ASSIGN,
        {
          workspaceId: context.workspaceId,
          resourceType: "Team",
          resourceId: teamId,
          teamId,
        },
      );
      if (decision.allowed) {
        return {
          canManageMembers: false,
          canManageTeams: false,
          canRedistribute: true,
          accessScope: "TEAM",
          teamIds,
        };
      }
    }

    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.LEADS_ASSIGN,
      {
        ...workspaceResource(context.workspaceId),
        teamId: teamIds[0] ?? null,
      },
    );
    throw new Error("Autorização inconsistente.");
  }

  async function assertFullAdministration(
    context: AuthenticatedContext,
  ): Promise<void> {
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.WORKSPACE_MEMBERS_MANAGE,
      workspaceResource(context.workspaceId),
    );
  }

  async function getMemberTeamIds(memberId: string, workspaceId: string) {
    const member = await options.database.workspaceMember.findFirst({
      where: { id: memberId, workspaceId, deletedAt: null },
      select: {
        id: true,
        teamMemberships: {
          where: { deletedAt: null, team: { deletedAt: null } },
          select: { teamId: true },
        },
      },
    });
    if (!member) notFound("Usuário do workspace não encontrado.");
    return member.teamMemberships.map(({ teamId }) => teamId);
  }

  async function assertCanRedistributeMember(
    context: AuthenticatedContext,
    memberId: string,
  ): Promise<void> {
    const teamIds = await getMemberTeamIds(memberId, context.workspaceId);
    for (const teamId of teamIds) {
      const decision = await options.authorization.authorize(
        context,
        PermissionKeys.LEADS_ASSIGN,
        {
          workspaceId: context.workspaceId,
          resourceType: "WorkspaceMember",
          resourceId: memberId,
          memberId,
          teamId,
        },
      );
      if (decision.allowed) return;
    }
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.LEADS_ASSIGN,
      {
        workspaceId: context.workspaceId,
        resourceType: "WorkspaceMember",
        resourceId: memberId,
        memberId,
        teamId: teamIds[0] ?? null,
      },
    );
  }

  async function getScreen(
    context: AuthenticatedContext,
  ): Promise<WorkspaceAdministrationScreen> {
    const access = await resolveAccess(context);
    const workspaceId = context.workspaceId;
    const teamFilter =
      access.accessScope === "TEAM" ? { id: { in: [...access.teamIds] } } : {};
    const memberFilter =
      access.accessScope === "TEAM"
        ? {
            teamMemberships: {
              some: { teamId: { in: [...access.teamIds] }, deletedAt: null },
            },
          }
        : {};

    const [workspace, roles, teams, members] = await Promise.all([
      options.database.workspace.findFirst({
        where: { id: workspaceId, deletedAt: null },
        select: { id: true, name: true, timeZone: true },
      }),
      options.database.role.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { name: "asc" },
        include: {
          permissions: {
            include: { permission: true },
            orderBy: { permission: { key: "asc" } },
          },
        },
      }),
      options.database.team.findMany({
        where: { workspaceId, deletedAt: null, ...teamFilter },
        orderBy: { name: "asc" },
      }),
      options.database.workspaceMember.findMany({
        where: { workspaceId, deletedAt: null, ...memberFilter },
        include: {
          user: true,
          role: {
            include: {
              permissions: {
                include: { permission: true },
                orderBy: { permission: { key: "asc" } },
              },
            },
          },
          teamMemberships: {
            where: { deletedAt: null, team: { deletedAt: null } },
            include: { team: true },
            orderBy: { team: { name: "asc" } },
          },
        },
      }),
    ]);
    if (!workspace) notFound("Workspace não encontrado.");

    members.sort((left, right) =>
      left.user.displayName.localeCompare(right.user.displayName, "pt-BR"),
    );
    const memberIds = members.map(({ id }) => id);
    const now = clock();
    const [leadCounts, taskCounts, meetingCounts, opportunityCounts, teamMembers, queues] =
      await Promise.all([
        options.database.lead.groupBy({
          by: ["ownerMemberId"],
          where: {
            workspaceId,
            ownerMemberId: { in: memberIds },
            status: { in: ["OPEN", "QUALIFIED"] },
            deletedAt: null,
          },
          _count: { _all: true },
        }),
        options.database.task.groupBy({
          by: ["assigneeMemberId"],
          where: {
            workspaceId,
            assigneeMemberId: { in: memberIds },
            status: { in: ["OPEN", "IN_PROGRESS"] },
            deletedAt: null,
          },
          _count: { _all: true },
        }),
        options.database.meeting.groupBy({
          by: ["ownerMemberId"],
          where: {
            workspaceId,
            ownerMemberId: { in: memberIds },
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            startsAt: { gte: now },
            deletedAt: null,
          },
          _count: { _all: true },
        }),
        options.database.opportunity.groupBy({
          by: ["ownerMemberId"],
          where: {
            workspaceId,
            ownerMemberId: { in: memberIds },
            status: "OPEN",
            deletedAt: null,
          },
          _count: { _all: true },
        }),
        options.database.teamMember.findMany({
          where: {
            workspaceId,
            teamId: { in: teams.map(({ id }) => id) },
            deletedAt: null,
            member: { deletedAt: null },
          },
          select: {
            teamId: true,
            function: true,
            member: { select: { status: true, user: { select: { status: true } } } },
          },
        }),
        options.database.queue.findMany({
          where: {
            workspaceId,
            teamId: { in: teams.map(({ id }) => id) },
            isGeneral: true,
            deletedAt: null,
          },
          select: { id: true, teamId: true },
        }),
      ]);

    const leadCountByMember = countMap(leadCounts);
    const taskCountByMember = new Map(
      taskCounts.flatMap((row) =>
        row.assigneeMemberId
          ? [[row.assigneeMemberId, row._count._all] as const]
          : [],
      ),
    );
    const meetingCountByMember = new Map(
      meetingCounts.map((row) => [row.ownerMemberId, row._count._all] as const),
    );
    const opportunityCountByMember = new Map(
      opportunityCounts.map((row) => [row.ownerMemberId, row._count._all] as const),
    );

    const queueIds = queues.map(({ id }) => id);
    const leadCountByRoutingQueue = queueIds.length
      ? await options.database.lead.groupBy({
          by: ["routingQueueId"],
          where: {
            workspaceId,
            routingQueueId: { in: queueIds },
            status: { in: ["OPEN", "QUALIFIED"] },
            deletedAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const routingCounts = new Map(
      leadCountByRoutingQueue.flatMap((row) =>
        row.routingQueueId
          ? [[row.routingQueueId, row._count._all] as const]
          : [],
      ),
    );
    const queueToTeam = new Map(
      queues.flatMap(({ id, teamId }) => (teamId ? [[id, teamId] as const] : [])),
    );
    const openLeadsByTeam = new Map<string, number>();
    for (const [queueId, count] of routingCounts) {
      const teamId = queueToTeam.get(queueId);
      if (teamId) openLeadsByTeam.set(teamId, (openLeadsByTeam.get(teamId) ?? 0) + count);
    }

    const roleRows = roles.map(
      (role): AdministrationRole => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        permissions: role.permissions.map(({ permission, scope }) => ({
          key: permission.key,
          description: permission.description,
          scope,
        })),
      }),
    );
    const roleById = new Map(roleRows.map((role) => [role.id, role] as const));
    const memberRows = members.map(
      (member): AdministrationMember => ({
        id: member.id,
        userId: member.userId,
        displayName: member.user.displayName,
        email: member.user.email,
        status: member.status,
        userStatus: member.user.status,
        role: roleById.get(member.roleId) ?? {
          id: member.role.id,
          key: member.role.key,
          name: member.role.name,
          description: member.role.description,
          permissions: member.role.permissions.map(({ permission, scope }) => ({
            key: permission.key,
            description: permission.description,
            scope,
          })),
        },
        teamAssignments: member.teamMemberships.map((assignment) => ({
          id: assignment.id,
          teamId: assignment.teamId,
          teamName: assignment.team.name,
          function: assignment.function,
        })),
        leadReceivingPausedAt: member.leadReceivingPausedAt?.toISOString() ?? null,
        leadReceivingPauseReason: member.leadReceivingPauseReason,
        workload: {
          openLeads: leadCountByMember.get(member.id) ?? 0,
          openTasks: taskCountByMember.get(member.id) ?? 0,
          futureMeetings: meetingCountByMember.get(member.id) ?? 0,
          openOpportunities: opportunityCountByMember.get(member.id) ?? 0,
        },
        updatedAt: member.updatedAt.toISOString(),
        isCurrentMember: member.id === context.memberId,
      }),
    );
    const teamRows = teams.map((team): AdministrationTeam => {
      const assignments = teamMembers.filter(({ teamId }) => teamId === team.id);
      return {
        id: team.id,
        name: team.name,
        description: team.description,
        members: assignments.length,
        activeMembers: assignments.filter(
          ({ member }) =>
            member.status === "ACTIVE" && member.user.status === "ACTIVE",
        ).length,
        sdrs: assignments.filter(({ function: value }) => value === "SDR").length,
        closers: assignments.filter(({ function: value }) => value === "CLOSER").length,
        openLeads: openLeadsByTeam.get(team.id) ?? 0,
        updatedAt: team.updatedAt.toISOString(),
      };
    });

    const visibleLeadFilter: Prisma.LeadWhereInput =
      access.accessScope === "WORKSPACE"
        ? {}
        : {
            OR: [
              { ownerMemberId: { in: memberIds } },
              { routingQueue: { teamId: { in: [...access.teamIds] } } },
              { queue: { teamId: { in: [...access.teamIds] } } },
            ],
          };
    const [openLeads, leadsInGeneralQueue] = await Promise.all([
      options.database.lead.count({
        where: {
          workspaceId,
          status: { in: ["OPEN", "QUALIFIED"] },
          deletedAt: null,
          ...visibleLeadFilter,
        },
      }),
      options.database.lead.count({
        where: {
          workspaceId,
          status: { in: ["OPEN", "QUALIFIED"] },
          deletedAt: null,
          queue: {
            isGeneral: true,
            deletedAt: null,
            ...(access.accessScope === "TEAM"
              ? { teamId: { in: [...access.teamIds] } }
              : {}),
          },
        },
      }),
    ]);

    return Object.freeze({
      workspace,
      capabilities: {
        canManageMembers: access.canManageMembers,
        canManageTeams: access.canManageTeams,
        canRedistribute: access.canRedistribute,
        accessScope: access.accessScope,
      },
      summary: {
        members: memberRows.length,
        activeMembers: memberRows.filter(
          ({ status, userStatus }) => status === "ACTIVE" && userStatus === "ACTIVE",
        ).length,
        inactiveMembers: memberRows.filter(
          ({ status, userStatus }) => status !== "ACTIVE" || userStatus !== "ACTIVE",
        ).length,
        pausedSdrs: memberRows.filter(
          ({ leadReceivingPausedAt }) => leadReceivingPausedAt !== null,
        ).length,
        openLeads,
        leadsInGeneralQueue,
      },
      roles: roleRows,
      teams: teamRows,
      members: memberRows,
    });
  }

  async function getMemberForPreview(context: AuthenticatedContext, memberId: string) {
    const member = await options.database.workspaceMember.findFirst({
      where: { id: memberId, workspaceId: context.workspaceId, deletedAt: null },
      include: {
        user: true,
        role: { include: { permissions: true } },
        teamMemberships: {
          where: { deletedAt: null },
          include: { team: true },
        },
        _count: {
          select: {
            leadsOwned: {
              where: { status: { in: ["OPEN", "QUALIFIED"] }, deletedAt: null },
            },
            authSessions: { where: { revokedAt: null } },
            meetingsOwned: {
              where: {
                status: { in: ["SCHEDULED", "CONFIRMED"] },
                startsAt: { gte: clock() },
                deletedAt: null,
              },
            },
            opportunitiesOwned: { where: { status: "OPEN", deletedAt: null } },
          },
        },
      },
    });
    if (!member) notFound("Usuário do workspace não encontrado.");
    return member;
  }

  async function validateRoleAndTeams(
    workspaceId: string,
    roleId: string,
    assignments: readonly Readonly<{ teamId: string; function: TeamFunction }>[],
  ): Promise<void> {
    const [role, teams] = await Promise.all([
      options.database.role.findFirst({
        where: { id: roleId, workspaceId, deletedAt: null },
        select: { id: true },
      }),
      options.database.team.findMany({
        where: {
          workspaceId,
          id: { in: assignments.map(({ teamId }) => teamId) },
          deletedAt: null,
        },
        select: { id: true },
      }),
    ]);
    if (!role) notFound("Papel de acesso não encontrado.");
    if (teams.length !== assignments.length) {
      notFound("Uma das equipes informadas não pertence ao workspace.");
    }
  }

  async function preview(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<WorkspaceAdministrationPreview> {
    const command = parseCommand(input);

    if (
      command.action === "SET_MEMBER_RECEIVING_PAUSE" ||
      command.action === "REDISTRIBUTE_MEMBER_LEADS"
    ) {
      await assertCanRedistributeMember(context, command.memberId);
    } else {
      await assertFullAdministration(context);
    }

    switch (command.action) {
      case "CREATE_MEMBER": {
        await validateRoleAndTeams(
          context.workspaceId,
          command.roleId,
          command.teamAssignments,
        );
        return {
          action: command.action,
          title: "Criar usuário local",
          summary: `${command.displayName} será criado com acesso ao workspace.`,
          impacts: [
            { key: "teams", label: "Equipes vinculadas", count: command.teamAssignments.length },
          ],
          warnings: ["A senha não será exibida novamente nem registrada na auditoria."],
          requiresConfirmation: true,
        };
      }
      case "UPDATE_MEMBER_PROFILE": {
        const member = await getMemberForPreview(context, command.memberId);
        return {
          action: command.action,
          title: "Alterar identificação do usuário",
          summary: `${member.user.displayName} terá nome e e-mail atualizados.`,
          impacts: [],
          warnings: member.user.email === command.email ? [] : ["O novo e-mail será usado no próximo login."],
          requiresConfirmation: true,
        };
      }
      case "CHANGE_MEMBER_ROLE": {
        const [member, role] = await Promise.all([
          getMemberForPreview(context, command.memberId),
          options.database.role.findFirst({
            where: { id: command.roleId, workspaceId: context.workspaceId, deletedAt: null },
            include: { _count: { select: { permissions: true } } },
          }),
        ]);
        if (!role) notFound("Papel de acesso não encontrado.");
        if (member.id === context.memberId && member.roleId !== role.id) {
          conflict(
            "SELF_ROLE_CHANGE_FORBIDDEN",
            "Você não pode alterar o próprio papel de acesso.",
          );
        }
        return {
          action: command.action,
          title: "Alterar papel de acesso",
          summary: `${member.user.displayName}: ${member.role.name} → ${role.name}.`,
          impacts: [
            { key: "permissions_before", label: "Permissões atuais", count: member.role.permissions.length },
            { key: "permissions_after", label: "Permissões após a mudança", count: role._count.permissions },
          ],
          warnings: ["A função comercial nas equipes não será alterada."],
          requiresConfirmation: true,
        };
      }
      case "SET_MEMBER_STATUS": {
        const member = await getMemberForPreview(context, command.memberId);
        if (member.id === context.memberId && command.status === "INACTIVE") {
          conflict(
            "SELF_INACTIVATION_FORBIDDEN",
            "Você não pode inativar o próprio acesso.",
          );
        }
        return {
          action: command.action,
          title: command.status === "ACTIVE" ? "Reativar usuário" : "Inativar usuário",
          summary: `${member.user.displayName} ficará ${command.status === "ACTIVE" ? "ativo" : "inativo"} neste workspace.`,
          impacts: [
            { key: "open_leads", label: "Leads abertos", count: member._count.leadsOwned },
            { key: "sessions", label: "Sessões ativas", count: member._count.authSessions },
            { key: "meetings", label: "Reuniões futuras", count: member._count.meetingsOwned },
            { key: "opportunities", label: "Oportunidades abertas", count: member._count.opportunitiesOwned },
          ],
          warnings:
            command.status === "INACTIVE"
              ? [
                  "Leads abertos serão redistribuídos no mesmo commit.",
                  "Autoria e histórico comercial serão preservados.",
                  ...(member._count.meetingsOwned || member._count.opportunitiesOwned
                    ? ["Reuniões e oportunidades permanecem vinculadas para tratamento operacional explícito."]
                    : []),
                ]
              : [],
          requiresConfirmation: true,
        };
      }
      case "SET_MEMBER_RECEIVING_PAUSE": {
        const member = await getMemberForPreview(context, command.memberId);
        if (!member.teamMemberships.some(({ function: value }) => value === "SDR")) {
          invalidInput("Somente um SDR pode pausar o recebimento de leads.");
        }
        return {
          action: command.action,
          title: command.paused ? "Pausar recebimento" : "Retomar recebimento",
          summary: `${member.user.displayName} ${command.paused ? "deixará de receber" : "voltará a receber"} novos leads.`,
          impacts: [
            { key: "open_leads", label: "Leads já atribuídos", count: member._count.leadsOwned },
          ],
          warnings: ["Leads existentes não serão redistribuídos automaticamente por esta ação."],
          requiresConfirmation: true,
        };
      }
      case "SAVE_MEMBER_TEAMS": {
        const member = await getMemberForPreview(context, command.memberId);
        await validateRoleAndTeams(
          context.workspaceId,
          member.roleId,
          command.teamAssignments,
        );
        return {
          action: command.action,
          title: "Alterar equipes e função comercial",
          summary: `${member.user.displayName} passará a ter ${command.teamAssignments.length} vínculo(s) de equipe.`,
          impacts: [
            { key: "before", label: "Vínculos atuais", count: member.teamMemberships.length },
            { key: "after", label: "Vínculos após a mudança", count: command.teamAssignments.length },
            { key: "open_leads", label: "Leads abertos", count: member._count.leadsOwned },
          ],
          warnings: ["Papel de acesso e função comercial continuam sendo conceitos separados."],
          requiresConfirmation: true,
        };
      }
      case "SAVE_TEAM": {
        const team = command.id
          ? await options.database.team.findFirst({
              where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null },
              include: { _count: { select: { members: true, queues: true } } },
            })
          : null;
        if (command.id && !team) notFound("Equipe não encontrada.");
        return {
          action: command.action,
          title: team ? "Editar equipe" : "Criar equipe",
          summary: team ? `${team.name} será atualizada.` : `${command.name} será criada.`,
          impacts: team
            ? [
                { key: "members", label: "Vínculos de usuários", count: team._count.members },
                { key: "queues", label: "Filas vinculadas", count: team._count.queues },
              ]
            : [],
          warnings: [],
          requiresConfirmation: true,
        };
      }
      case "REDISTRIBUTE_MEMBER_LEADS": {
        const member = await getMemberForPreview(context, command.memberId);
        if (targetMemberId(command.target) === member.id) {
          invalidInput("O destino deve ser diferente do responsável atual.");
        }
        return {
          action: command.action,
          title: "Redistribuir carga aberta",
          summary: `${member._count.leadsOwned} lead(s) de ${member.user.displayName} serão redistribuídos.`,
          impacts: [
            { key: "open_leads", label: "Leads abertos", count: member._count.leadsOwned },
          ],
          warnings: ["Tarefas abertas desses leads acompanharão a nova responsabilidade."],
          requiresConfirmation: true,
        };
      }
    }
  }

  async function lockMember(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    memberId: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`workspace-member:${workspaceId}:${memberId}`}, 0)
      )
    `;
  }

  function assertExpectedUpdate(actual: Date, expected: string): void {
    if (actual.toISOString() !== expected) {
      conflict(
        "STALE_ADMINISTRATION_DATA",
        "Os dados foram alterados por outra pessoa. Recarregue antes de confirmar.",
      );
    }
  }

  async function assertNotRemovingLastAdministrator(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    memberId: string,
  ): Promise<void> {
    const activeAdministrators = await transaction.workspaceMember.count({
      where: {
        workspaceId,
        id: { not: memberId },
        status: "ACTIVE",
        deletedAt: null,
        user: { status: "ACTIVE", deletedAt: null },
        role: { key: "administrator", deletedAt: null },
      },
    });
    if (activeAdministrators === 0) {
      conflict(
        "LAST_ADMINISTRATOR_REQUIRED",
        "O workspace precisa manter ao menos um administrador ativo.",
      );
    }
  }

  async function createMember(
    context: AuthenticatedContext,
    command: z.infer<typeof createMemberCommand>,
  ): Promise<void> {
    await assertFullAdministration(context);
    await validateRoleAndTeams(context.workspaceId, command.roleId, command.teamAssignments);
    const passwordHash = await hashPassword(command.password);
    const occurredAt = clock();
    await options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`local-user-email:${command.email}`}, 0)
        )
      `;
      const existing = await transaction.user.findUnique({
        where: { normalizedEmail: command.email },
        select: { id: true },
      });
      if (existing) {
        conflict(
          "EMAIL_ALREADY_REGISTERED",
          "Este e-mail já pertence a uma identidade local.",
        );
      }
      const user = await transaction.user.create({
        data: {
          email: command.email,
          normalizedEmail: command.email,
          displayName: command.displayName,
          status: "ACTIVE",
        },
      });
      await transaction.localCredential.create({
        data: { userId: user.id, passwordHash, passwordChangedAt: occurredAt },
      });
      const member = await transaction.workspaceMember.create({
        data: {
          workspaceId: context.workspaceId,
          userId: user.id,
          roleId: command.roleId,
          status: "ACTIVE",
          joinedAt: occurredAt,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
        },
      });
      await transaction.actor.create({
        data: {
          workspaceId: context.workspaceId,
          userId: user.id,
          type: "HUMAN",
          key: `user:${user.id}`,
          displayName: command.displayName,
        },
      });
      if (command.teamAssignments.length) {
        await transaction.teamMember.createMany({
          data: command.teamAssignments.map((assignment) => ({
            workspaceId: context.workspaceId,
            teamId: assignment.teamId,
            workspaceMemberId: member.id,
            function: assignment.function,
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
          })),
        });
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "workspace.member.created",
          entityType: "WorkspaceMember",
          entityId: member.id,
          occurredAt,
          changes: {
            displayName: command.displayName,
            email: command.email,
            roleId: command.roleId,
            teamAssignments: command.teamAssignments,
          },
          metadata: { credentialCreated: true, passwordRecorded: false },
        },
      });
      await options.beforeCommit?.();
    });
  }

  async function updateMemberProfile(
    context: AuthenticatedContext,
    command: z.infer<typeof updateMemberProfileCommand>,
  ): Promise<void> {
    await assertFullAdministration(context);
    const occurredAt = clock();
    await options.database.$transaction(async (transaction) => {
      await lockMember(transaction, context.workspaceId, command.memberId);
      const member = await transaction.workspaceMember.findFirst({
        where: { id: command.memberId, workspaceId: context.workspaceId, deletedAt: null },
        include: { user: { include: { _count: { select: { memberships: true } } } } },
      });
      if (!member) notFound("Usuário do workspace não encontrado.");
      assertExpectedUpdate(member.updatedAt, command.expectedUpdatedAt);
      if (member.user._count.memberships > 1) {
        conflict(
          "SHARED_IDENTITY_PROFILE",
          "Esta identidade pertence a mais de um workspace e não pode ser alterada por esta tela.",
        );
      }
      const duplicate = await transaction.user.findFirst({
        where: { normalizedEmail: command.email, id: { not: member.userId } },
        select: { id: true },
      });
      if (duplicate) conflict("EMAIL_ALREADY_REGISTERED", "Este e-mail já está em uso.");
      await transaction.user.update({
        where: { id: member.userId },
        data: {
          displayName: command.displayName,
          email: command.email,
          normalizedEmail: command.email,
        },
      });
      await transaction.actor.updateMany({
        where: {
          workspaceId: context.workspaceId,
          userId: member.userId,
          type: "HUMAN",
        },
        data: { displayName: command.displayName },
      });
      await transaction.workspaceMember.update({
        where: { id: member.id },
        data: { updatedByActorId: context.actorId },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "workspace.member.profile.updated",
          entityType: "WorkspaceMember",
          entityId: member.id,
          occurredAt,
          changes: {
            before: {
              displayName: member.user.displayName,
              email: member.user.email,
            },
            after: { displayName: command.displayName, email: command.email },
          },
        },
      });
      await options.beforeCommit?.();
    });
  }

  async function changeMemberRole(
    context: AuthenticatedContext,
    command: z.infer<typeof changeMemberRoleCommand>,
  ): Promise<void> {
    await assertFullAdministration(context);
    if (command.memberId === context.memberId) {
      conflict("SELF_ROLE_CHANGE_FORBIDDEN", "Você não pode alterar o próprio papel de acesso.");
    }
    const occurredAt = clock();
    await options.database.$transaction(async (transaction) => {
      await lockMember(transaction, context.workspaceId, command.memberId);
      const [member, role] = await Promise.all([
        transaction.workspaceMember.findFirst({
          where: { id: command.memberId, workspaceId: context.workspaceId, deletedAt: null },
          include: { role: true },
        }),
        transaction.role.findFirst({
          where: { id: command.roleId, workspaceId: context.workspaceId, deletedAt: null },
        }),
      ]);
      if (!member || !role) notFound("Usuário ou papel de acesso não encontrado.");
      assertExpectedUpdate(member.updatedAt, command.expectedUpdatedAt);
      if (member.role.key === "administrator" && role.key !== "administrator") {
        await assertNotRemovingLastAdministrator(transaction, context.workspaceId, member.id);
      }
      if (member.roleId === role.id) conflict("NO_ROLE_CHANGE", "O papel informado já está aplicado.");
      await transaction.workspaceMember.update({
        where: { id: member.id },
        data: { roleId: role.id, updatedByActorId: context.actorId },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "workspace.member.role.changed",
          entityType: "WorkspaceMember",
          entityId: member.id,
          occurredAt,
          changes: {
            before: { roleId: member.roleId, roleName: member.role.name },
            after: { roleId: role.id, roleName: role.name },
            reason: command.reason,
          },
        },
      });
      await options.beforeCommit?.();
    });
  }

  async function lockRoutingQueues(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<void> {
    const queues = await transaction.queue.findMany({
      where: { workspaceId, isGeneral: true, deletedAt: null },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    for (const queue of queues) {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`lead-round-robin:${workspaceId}:${queue.id}`}, 0)
        )
      `;
    }
  }

  async function reassignOwnedOpenLeads(
    transaction: Prisma.TransactionClient,
    context: AuthenticatedContext,
    memberId: string,
    target: z.infer<typeof redistributionTargetSchema>,
    reason: string,
    occurredAt: Date,
  ): Promise<number> {
    const destinationMemberId = targetMemberId(target);
    if (destinationMemberId === memberId) {
      invalidInput("O destino deve ser diferente do responsável atual.");
    }
    const leads = await transaction.lead.findMany({
      where: {
        workspaceId: context.workspaceId,
        ownerMemberId: memberId,
        status: { in: ["OPEN", "QUALIFIED"] },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    for (const lead of leads) {
      await reassignLeadInTransaction(transaction, {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        leadId: lead.id,
        targetMemberId: destinationMemberId,
        expectedOwnerMemberId: memberId,
        reason,
        type: "REDISTRIBUTION",
        requireGeneralQueueOrigin: false,
        reassignAllOpenTasks: true,
        assignedAt: occurredAt,
      });
    }
    return leads.length;
  }

  async function setMemberStatus(
    context: AuthenticatedContext,
    command: z.infer<typeof setMemberStatusCommand>,
  ): Promise<void> {
    await assertFullAdministration(context);
    if (command.memberId === context.memberId && command.status === "INACTIVE") {
      conflict("SELF_INACTIVATION_FORBIDDEN", "Você não pode inativar o próprio acesso.");
    }
    const occurredAt = clock();
    await options.database.$transaction(async (transaction) => {
      if (command.status === "INACTIVE") {
        await lockRoutingQueues(transaction, context.workspaceId);
      }
      await lockMember(transaction, context.workspaceId, command.memberId);
      const member = await transaction.workspaceMember.findFirst({
        where: { id: command.memberId, workspaceId: context.workspaceId, deletedAt: null },
        include: { role: true, user: true },
      });
      if (!member) notFound("Usuário do workspace não encontrado.");
      assertExpectedUpdate(member.updatedAt, command.expectedUpdatedAt);
      if (member.status === command.status) {
        conflict("NO_STATUS_CHANGE", "O usuário já possui o status informado.");
      }
      if (command.status === "ACTIVE" && member.user.status !== "ACTIVE") {
        conflict(
          "USER_IDENTITY_DISABLED",
          "A identidade global está desabilitada e exige revisão técnica antes da reativação.",
        );
      }
      if (command.status === "INACTIVE" && member.role.key === "administrator") {
        await assertNotRemovingLastAdministrator(transaction, context.workspaceId, member.id);
      }

      await transaction.workspaceMember.update({
        where: { id: member.id },
        data: {
          status: command.status,
          ...(command.status === "ACTIVE" && !member.joinedAt ? { joinedAt: occurredAt } : {}),
          updatedByActorId: context.actorId,
        },
      });

      let redistributedLeads = 0;
      if (command.status === "INACTIVE") {
        const openLeads = await transaction.lead.count({
          where: {
            workspaceId: context.workspaceId,
            ownerMemberId: member.id,
            status: { in: ["OPEN", "QUALIFIED"] },
            deletedAt: null,
          },
        });
        if (openLeads > 0 && !command.redistributionTarget) {
          conflict(
            "REDISTRIBUTION_REQUIRED",
            "Escolha um SDR ou a Fila Geral para os leads abertos.",
          );
        }
        if (command.redistributionTarget) {
          redistributedLeads = await reassignOwnedOpenLeads(
            transaction,
            context,
            member.id,
            command.redistributionTarget,
            command.reason,
            occurredAt,
          );
        }
        await transaction.authSession.updateMany({
          where: {
            workspaceId: context.workspaceId,
            workspaceMemberId: member.id,
            revokedAt: null,
          },
          data: { revokedAt: occurredAt },
        });
      }

      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action:
            command.status === "ACTIVE"
              ? "workspace.member.activated"
              : "workspace.member.inactivated",
          entityType: "WorkspaceMember",
          entityId: member.id,
          occurredAt,
          changes: {
            before: { status: member.status },
            after: { status: command.status },
            reason: command.reason,
            redistributedLeads,
            redistributionTarget: command.redistributionTarget,
          },
        },
      });
      await options.beforeCommit?.();
    });
  }

  async function saveMemberTeams(
    context: AuthenticatedContext,
    command: z.infer<typeof saveMemberTeamsCommand>,
  ): Promise<void> {
    await assertFullAdministration(context);
    const occurredAt = clock();
    await options.database.$transaction(async (transaction) => {
      await lockMember(transaction, context.workspaceId, command.memberId);
      const member = await transaction.workspaceMember.findFirst({
        where: { id: command.memberId, workspaceId: context.workspaceId, deletedAt: null },
        include: {
          role: true,
          teamMemberships: { where: { deletedAt: null } },
        },
      });
      if (!member) notFound("Usuário do workspace não encontrado.");
      assertExpectedUpdate(member.updatedAt, command.expectedUpdatedAt);
      const teams = await transaction.team.findMany({
        where: {
          workspaceId: context.workspaceId,
          id: { in: command.teamAssignments.map(({ teamId }) => teamId) },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (teams.length !== command.teamAssignments.length) {
        notFound("Uma das equipes informadas não pertence ao workspace.");
      }

      const nextTeamIds = new Set(command.teamAssignments.map(({ teamId }) => teamId));
      const removedTeamIds = member.teamMemberships
        .map(({ teamId }) => teamId)
        .filter((teamId) => !nextTeamIds.has(teamId));
      if (removedTeamIds.length) {
        const affectedLeads = await transaction.lead.count({
          where: {
            workspaceId: context.workspaceId,
            ownerMemberId: member.id,
            status: { in: ["OPEN", "QUALIFIED"] },
            deletedAt: null,
            routingQueue: { teamId: { in: removedTeamIds } },
          },
        });
        if (affectedLeads > 0) {
          conflict(
            "TEAM_MEMBERSHIP_IN_USE",
            "Redistribua os leads abertos antes de remover esta equipe.",
          );
        }
      }

      for (const assignment of command.teamAssignments) {
        const existing = await transaction.teamMember.findFirst({
          where: {
            workspaceId: context.workspaceId,
            teamId: assignment.teamId,
            workspaceMemberId: member.id,
          },
        });
        if (existing) {
          await transaction.teamMember.update({
            where: { id: existing.id },
            data: {
              function: assignment.function,
              deletedAt: null,
              updatedByActorId: context.actorId,
            },
          });
        } else {
          await transaction.teamMember.create({
            data: {
              workspaceId: context.workspaceId,
              teamId: assignment.teamId,
              workspaceMemberId: member.id,
              function: assignment.function,
              createdByActorId: context.actorId,
              updatedByActorId: context.actorId,
            },
          });
        }
      }
      await transaction.teamMember.updateMany({
        where: {
          workspaceId: context.workspaceId,
          workspaceMemberId: member.id,
          deletedAt: null,
          ...(command.teamAssignments.length
            ? { teamId: { notIn: command.teamAssignments.map(({ teamId }) => teamId) } }
            : {}),
        },
        data: { deletedAt: occurredAt, updatedByActorId: context.actorId },
      });
      await transaction.workspaceMember.update({
        where: { id: member.id },
        data: { updatedByActorId: context.actorId },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "workspace.member.teams.changed",
          entityType: "WorkspaceMember",
          entityId: member.id,
          occurredAt,
          changes: {
            before: member.teamMemberships.map(({ teamId, function: value }) => ({
              teamId,
              function: value,
            })),
            after: command.teamAssignments,
          },
        },
      });
      await options.beforeCommit?.();
    });
  }

  async function saveTeam(
    context: AuthenticatedContext,
    command: z.infer<typeof saveTeamCommand>,
  ): Promise<void> {
    await assertFullAdministration(context);
    const occurredAt = clock();
    await options.database.$transaction(async (transaction) => {
      const duplicate = await transaction.team.findFirst({
        where: {
          workspaceId: context.workspaceId,
          name: { equals: command.name, mode: "insensitive" },
          deletedAt: null,
          ...(command.id ? { id: { not: command.id } } : {}),
        },
        select: { id: true },
      });
      if (duplicate) conflict("TEAM_NAME_IN_USE", "Já existe uma equipe com este nome.");
      if (command.id) {
        await lockMember(transaction, context.workspaceId, command.id);
        const team = await transaction.team.findFirst({
          where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null },
        });
        if (!team) notFound("Equipe não encontrada.");
        if (!command.expectedUpdatedAt) invalidInput("Informe a versão atual da equipe.");
        assertExpectedUpdate(team.updatedAt, command.expectedUpdatedAt);
        await transaction.team.update({
          where: { id: team.id },
          data: {
            name: command.name,
            description: command.description,
            updatedByActorId: context.actorId,
          },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "workspace.team.updated",
            entityType: "Team",
            entityId: team.id,
            occurredAt,
            changes: {
              before: { name: team.name, description: team.description },
              after: { name: command.name, description: command.description },
            },
          },
        });
      } else {
        const team = await transaction.team.create({
          data: {
            workspaceId: context.workspaceId,
            name: command.name,
            description: command.description,
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
          },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "workspace.team.created",
            entityType: "Team",
            entityId: team.id,
            occurredAt,
            changes: { name: command.name, description: command.description },
          },
        });
      }
      await options.beforeCommit?.();
    });
  }

  async function redistributeMemberLeads(
    context: AuthenticatedContext,
    command: z.infer<typeof redistributeMemberLeadsCommand>,
  ): Promise<void> {
    await assertCanRedistributeMember(context, command.memberId);
    const occurredAt = clock();
    await options.database.$transaction(async (transaction) => {
      await lockMember(transaction, context.workspaceId, command.memberId);
      const member = await transaction.workspaceMember.findFirst({
        where: { id: command.memberId, workspaceId: context.workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!member) notFound("Usuário do workspace não encontrado.");
      const redistributedLeads = await reassignOwnedOpenLeads(
        transaction,
        context,
        member.id,
        command.target,
        command.reason,
        occurredAt,
      );
      if (redistributedLeads === 0) {
        conflict("NO_OPEN_LEADS", "Este usuário não possui leads abertos para redistribuir.");
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "workspace.member.open_leads.redistributed",
          entityType: "WorkspaceMember",
          entityId: member.id,
          occurredAt,
          changes: {
            redistributedLeads,
            target: command.target,
            reason: command.reason,
          },
        },
      });
      await options.beforeCommit?.();
    });
  }

  async function apply(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<WorkspaceAdministrationScreen> {
    const command = parseCommand(input);
    if (!command.confirmed) {
      invalidInput("Confirme a alteração depois de revisar o impacto.");
    }
    await preview(context, command);

    switch (command.action) {
      case "CREATE_MEMBER":
        await createMember(context, command);
        break;
      case "UPDATE_MEMBER_PROFILE":
        await updateMemberProfile(context, command);
        break;
      case "CHANGE_MEMBER_ROLE":
        await changeMemberRole(context, command);
        break;
      case "SET_MEMBER_STATUS":
        await setMemberStatus(context, command);
        break;
      case "SET_MEMBER_RECEIVING_PAUSE":
        await distribution.setReceivingPause(context, {
          memberId: command.memberId,
          paused: command.paused,
          ...(command.paused ? { reason: command.reason ?? undefined } : {}),
        });
        break;
      case "SAVE_MEMBER_TEAMS":
        await saveMemberTeams(context, command);
        break;
      case "SAVE_TEAM":
        await saveTeam(context, command);
        break;
      case "REDISTRIBUTE_MEMBER_LEADS":
        await redistributeMemberLeads(context, command);
        break;
    }
    return getScreen(context);
  }

  async function changeMemberRoleLegacy(
    context: AuthenticatedContext,
    input: Readonly<{ workspaceId: string; memberId: string; roleId: string }>,
  ): Promise<Readonly<{ memberId: string; roleId: string }>> {
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.WORKSPACE_MEMBERS_MANAGE,
      {
        workspaceId: input.workspaceId,
        resourceType: "WorkspaceMember",
        resourceId: input.memberId,
        memberId: input.memberId,
      },
    );
    const member = await options.database.workspaceMember.findFirst({
      where: {
        id: input.memberId,
        workspaceId: context.workspaceId,
        deletedAt: null,
      },
      select: { id: true, updatedAt: true },
    });
    if (!member) notFound("Membro ou papel não encontrado.");
    await changeMemberRole(context, {
      action: "CHANGE_MEMBER_ROLE",
      confirmed: true,
      memberId: member.id,
      expectedUpdatedAt: member.updatedAt.toISOString(),
      roleId: input.roleId,
      reason: "Alteração administrativa confirmada.",
    });
    return { memberId: member.id, roleId: input.roleId };
  }

  return Object.freeze({
    getScreen,
    preview,
    apply,
    changeMemberRole: changeMemberRoleLegacy,
  });
}

let administrationService:
  | ReturnType<typeof createWorkspaceAdministrationService>
  | undefined;

export function getWorkspaceAdministrationService(): ReturnType<
  typeof createWorkspaceAdministrationService
> {
  administrationService ??= createWorkspaceAdministrationService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    distribution: getLeadDistributionService(),
    now: () => new Date(),
  });
  return administrationService;
}
