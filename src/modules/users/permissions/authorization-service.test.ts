import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";

const context = {
  sessionId: "session-1",
  workspaceId: "workspace-1",
  workspaceSlug: "workspace",
  userId: "user-1",
  memberId: "member-1",
  actorId: "actor-1",
  roleId: "role-1",
  roleKey: "administrator",
  roleName: "Administrador",
  displayName: "Administrador",
} satisfies AuthenticatedContext;

describe("authorization service", () => {
  it("nega um contexto não validado que não existe no workspace", async () => {
    const rolePermissionFindFirst = vi.fn();
    const service = createAuthorizationService({
      database: {
        workspaceMember: { findFirst: vi.fn().mockResolvedValue(null) },
        actor: { findFirst: vi.fn().mockResolvedValue(null) },
        rolePermission: { findFirst: rolePermissionFindFirst },
      } as never,
    });

    const decision = await service.authorize(
      context,
      PermissionKeys.LEADS_READ,
      { workspaceId: context.workspaceId, resourceType: "Lead" },
    );

    expect(decision).toEqual({
      allowed: false,
      reason: "INVALID_CONTEXT",
      contextIsValid: false,
    });
    expect(rolePermissionFindFirst).not.toHaveBeenCalled();
  });

  it("reaproveita as consultas idênticas durante a mesma requisição", async () => {
    const workspaceMemberFindFirst = vi.fn().mockResolvedValue({ id: context.memberId });
    const actorFindFirst = vi.fn().mockResolvedValue({ id: context.actorId });
    const rolePermissionFindFirst = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { scope: "WORKSPACE" };
    });
    const service = createAuthorizationService({
      database: {
        workspaceMember: { findFirst: workspaceMemberFindFirst },
        actor: { findFirst: actorFindFirst },
        rolePermission: { findFirst: rolePermissionFindFirst },
      } as never,
    });

    const decisions = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      service.authorize(context, PermissionKeys.LEADS_READ, {
        workspaceId: context.workspaceId,
        resourceType: "Lead",
        resourceId: `lead-${index}`,
      }),
    ));
    await service.authorize(context, PermissionKeys.LEADS_READ, {
      workspaceId: context.workspaceId,
      resourceType: "Lead",
      resourceId: "lead-sequencial",
    });

    expect(decisions.every((decision) => decision.allowed)).toBe(true);
    expect(workspaceMemberFindFirst).toHaveBeenCalledTimes(1);
    expect(actorFindFirst).toHaveBeenCalledTimes(1);
    expect(rolePermissionFindFirst).toHaveBeenCalledTimes(1);
  });
});
