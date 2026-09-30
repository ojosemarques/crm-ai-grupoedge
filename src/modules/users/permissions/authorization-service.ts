import type { ConversationChannel, PermissionScope, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { isSameWorkspace } from "@/shared/core/workspace/workspace-context";

export type ResourceScope = Readonly<{
  workspaceId: string;
  resourceType: string;
  resourceId?: string;
  ownerMemberId?: string | null;
  memberId?: string | null;
  queueId?: string | null;
  teamId?: string | null;
  sourceId?: string | null;
  opportunityId?: string | null;
  channel?: ConversationChannel | null;
}>;

type DenialReason =
  | "INVALID_CONTEXT"
  | "MISSING_PERMISSION"
  | "OUTSIDE_SCOPE"
  | "RESOURCE_DIMENSION_MISMATCH"
  | "WORKSPACE_MISMATCH";

export type AuthorizationDecision = Readonly<
  | { allowed: true; scope: PermissionScope }
  | { allowed: false; reason: DenialReason; contextIsValid: boolean }
>;

type AuthorizationServiceOptions = Readonly<{
  database: PrismaClient;
}>;

export function createAuthorizationService(options: AuthorizationServiceOptions) {
  const contextChecks = new WeakMap<AuthenticatedContext, Promise<boolean>>();
  const grants = new WeakMap<AuthenticatedContext, Map<PermissionKey, Promise<{ scope: PermissionScope } | null>>>();
  const teamIds = new WeakMap<AuthenticatedContext, Promise<string[]>>();

  async function hasValidContext(context: AuthenticatedContext): Promise<boolean> {
    const cached = contextChecks.get(context);
    if (cached) return cached;
    const check = (async () => {
      const [member, actor] = await Promise.all([
        options.database.workspaceMember.findFirst({
          where: {
            id: context.memberId,
            workspaceId: context.workspaceId,
            userId: context.userId,
            roleId: context.roleId,
            status: "ACTIVE",
            deletedAt: null,
            role: { deletedAt: null },
            workspace: { status: "ACTIVE", deletedAt: null },
          },
          select: { id: true },
        }),
        options.database.actor.findFirst({
          where: {
            id: context.actorId,
            workspaceId: context.workspaceId,
            userId: context.userId,
            type: "HUMAN",
          },
          select: { id: true },
        }),
      ]);

      return Boolean(member && actor);
    })().catch((error: unknown) => {
      contextChecks.delete(context);
      throw error;
    });
    contextChecks.set(context, check);
    return check;
  }

  async function getTeamIds(context: AuthenticatedContext): Promise<string[]> {
    const cached = teamIds.get(context);
    if (cached) return cached;
    const lookup = (async () => {
      const memberships = await options.database.teamMember.findMany({
        where: {
          workspaceId: context.workspaceId,
          workspaceMemberId: context.memberId,
          deletedAt: null,
          team: { deletedAt: null },
        },
        select: { teamId: true },
      });

      return memberships.map((membership) => membership.teamId);
    })().catch((error: unknown) => {
      teamIds.delete(context);
      throw error;
    });
    teamIds.set(context, lookup);
    return lookup;
  }

  function getGrant(context: AuthenticatedContext, permissionKey: PermissionKey) {
    let contextGrants = grants.get(context);
    if (!contextGrants) {
      contextGrants = new Map();
      grants.set(context, contextGrants);
    }
    const cached = contextGrants.get(permissionKey);
    if (cached) return cached;
    const lookup = options.database.rolePermission.findFirst({
        where: {
          workspaceId: context.workspaceId,
          roleId: context.roleId,
          permission: { key: permissionKey },
          role: { deletedAt: null },
        },
        select: { scope: true },
      }).catch((error: unknown) => {
        contextGrants?.delete(permissionKey);
        throw error;
      });
    contextGrants.set(permissionKey, lookup);
    return lookup;
  }

  async function queueBelongsToTeams(
    context: AuthenticatedContext,
    queueId: string,
    teamIds: readonly string[],
  ): Promise<boolean> {
    if (teamIds.length === 0) {
      return false;
    }

    const queue = await options.database.queue.findFirst({
      where: {
        id: queueId,
        workspaceId: context.workspaceId,
        teamId: { in: [...teamIds] },
        deletedAt: null,
      },
      select: { id: true },
    });

    return Boolean(queue);
  }

  async function memberBelongsToTeams(
    context: AuthenticatedContext,
    memberId: string,
    teamIds: readonly string[],
  ): Promise<boolean> {
    if (teamIds.length === 0) {
      return false;
    }

    const membership = await options.database.teamMember.findFirst({
      where: {
        workspaceId: context.workspaceId,
        workspaceMemberId: memberId,
        teamId: { in: [...teamIds] },
        deletedAt: null,
        member: { status: "ACTIVE", deletedAt: null },
      },
      select: { id: true },
    });

    return Boolean(membership);
  }

  async function isWithinScope(
    context: AuthenticatedContext,
    scope: PermissionScope,
    resource: ResourceScope,
  ): Promise<boolean> {
    if (scope === "WORKSPACE") {
      return true;
    }

    if (
      resource.ownerMemberId === context.memberId ||
      resource.memberId === context.memberId
    ) {
      return true;
    }

    if (scope === "OWN") {
      return false;
    }

    const teamIds = await getTeamIds(context);

    if (resource.queueId) {
      const canAccessQueue = await queueBelongsToTeams(
        context,
        resource.queueId,
        teamIds,
      );
      if (canAccessQueue) {
        return true;
      }
    }

    if (resource.teamId && teamIds.includes(resource.teamId)) {
      return true;
    }

    const targetMemberId = resource.ownerMemberId ?? resource.memberId;
    return targetMemberId
      ? memberBelongsToTeams(context, targetMemberId, teamIds)
      : false;
  }

  async function resourceDimensionsMatch(resource: ResourceScope): Promise<boolean> {
    const checks: Array<Promise<unknown>> = [];

    if (resource.sourceId) {
      checks.push(options.database.leadSource.findFirst({
        where: {
          id: resource.sourceId,
          workspaceId: resource.workspaceId,
          deletedAt: null,
        },
        select: { id: true },
      }));
    }

    if (resource.opportunityId) {
      checks.push(options.database.opportunity.findFirst({
        where: {
          id: resource.opportunityId,
          workspaceId: resource.workspaceId,
          deletedAt: null,
        },
        select: { id: true },
      }));
    }

    if (resource.channel && resource.resourceType === "Conversation" && resource.resourceId) {
      checks.push(options.database.conversation.findFirst({
        where: {
          id: resource.resourceId,
          workspaceId: resource.workspaceId,
          channel: resource.channel,
          ...(resource.opportunityId
            ? { opportunityId: resource.opportunityId }
            : {}),
          deletedAt: null,
        },
        select: { id: true },
      }));
    }

    if (checks.length === 0) {
      return true;
    }

    return (await Promise.all(checks)).every(Boolean);
  }

  async function authorize(
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ): Promise<AuthorizationDecision> {
    const contextIsValid = await hasValidContext(context);
    if (!contextIsValid) {
      return { allowed: false, reason: "INVALID_CONTEXT", contextIsValid: false };
    }

    if (!isSameWorkspace(context, resource.workspaceId)) {
      return {
        allowed: false,
        reason: "WORKSPACE_MISMATCH",
        contextIsValid: true,
      };
    }

    if (!(await resourceDimensionsMatch(resource))) {
      return {
        allowed: false,
        reason: "RESOURCE_DIMENSION_MISMATCH",
        contextIsValid: true,
      };
    }

    const grant = await getGrant(context, permissionKey);

    if (!grant) {
      return {
        allowed: false,
        reason: "MISSING_PERMISSION",
        contextIsValid: true,
      };
    }

    if (!(await isWithinScope(context, grant.scope, resource))) {
      return {
        allowed: false,
        reason: "OUTSIDE_SCOPE",
        contextIsValid: true,
      };
    }

    return { allowed: true, scope: grant.scope };
  }

  async function getEffectivePermissionKeys(
    context: AuthenticatedContext,
  ): Promise<readonly string[]> {
    if (!(await hasValidContext(context))) {
      throw new AccessDeniedError();
    }

    const rows = await options.database.rolePermission.findMany({
      where: {
        workspaceId: context.workspaceId,
        roleId: context.roleId,
        role: { deletedAt: null },
      },
      select: { permission: { select: { key: true } } },
      orderBy: { permission: { key: "asc" } },
    });

    return Object.freeze(rows.map(({ permission }) => permission.key));
  }

  async function assertAuthorized(
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ): Promise<void> {
    const decision = await authorize(context, permissionKey, resource);
    if (decision.allowed) {
      return;
    }

    if (decision.contextIsValid) {
      await options.database.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "authorization.denied",
          origin: "API",
          entityType: "Workspace",
          entityId: context.workspaceId,
          changes: {
            permission: permissionKey,
            reason: decision.reason,
          },
          metadata: {
            requestedWorkspaceId: resource.workspaceId,
            resourceType: resource.resourceType,
            resourceId: resource.resourceId ?? null,
            sourceId: resource.sourceId ?? null,
            opportunityId: resource.opportunityId ?? null,
            channel: resource.channel ?? null,
          },
        },
      });
    }

    throw new AccessDeniedError();
  }

  return Object.freeze({ authorize, assertAuthorized, getEffectivePermissionKeys });
}

let authorizationService: ReturnType<typeof createAuthorizationService> | undefined;

export function getAuthorizationService(): ReturnType<
  typeof createAuthorizationService
> {
  authorizationService ??= createAuthorizationService({
    database: getDatabaseClient(),
  });
  return authorizationService;
}
