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
  it.each([
    { label: "Carlos", email: "carloshenrique@politizai.com", workspaceSlug: "politizai", identityMatches: true, permission: PermissionKeys.MEETINGS_READ, scope: "WORKSPACE" },
    { label: "e-mail normalizado", email: " CarlosHenrique@Politizai.com ", workspaceSlug: "politizai", identityMatches: true, permission: PermissionKeys.MEETINGS_READ, scope: "WORKSPACE" },
    { label: "outro vendedor", email: "outro@politizai.com", workspaceSlug: "politizai", identityMatches: true, permission: PermissionKeys.MEETINGS_READ, scope: null },
    { label: "outro workspace", email: "carloshenrique@politizai.com", workspaceSlug: "outro", identityMatches: true, permission: PermissionKeys.MEETINGS_READ, scope: null },
    { label: "identidade divergente", email: "carloshenrique@politizai.com", workspaceSlug: "politizai", identityMatches: false, permission: PermissionKeys.MEETINGS_READ, scope: null },
    { label: "escrita de reunião", email: "carloshenrique@politizai.com", workspaceSlug: "politizai", identityMatches: true, permission: PermissionKeys.MEETINGS_WRITE, scope: "WORKSPACE" },
    { label: "leads alheios", email: "carloshenrique@politizai.com", workspaceSlug: "politizai", identityMatches: true, permission: PermissionKeys.LEADS_READ, scope: null },
    { label: "transcrições alheias", email: "carloshenrique@politizai.com", workspaceSlug: "politizai", identityMatches: true, permission: PermissionKeys.MEETING_TRANSCRIPTS_READ, scope: null },
  ])("restringe agenda compartilhada à identidade e permissão corretas: $label", async ({ email, workspaceSlug, identityMatches, permission, scope }) => {
    const schedulerContext = { ...context, email, workspaceSlug };
    const memberLookup = vi.fn().mockImplementation(async ({ where }) => where.user && !identityMatches ? null : { id: context.memberId });
    const service = createAuthorizationService({ database: {
      workspaceMember: { findFirst: memberLookup },
      actor: { findFirst: vi.fn().mockResolvedValue({ id: context.actorId }) },
      rolePermission: { findFirst: vi.fn().mockResolvedValue({ scope: "OWN" }) },
    } as never });
    const decision = await service.authorize(schedulerContext, permission, { workspaceId: context.workspaceId, resourceType: "Meeting", ownerMemberId: "another-member" });
    expect(decision).toEqual(scope ? { allowed: true, scope } : { allowed: false, reason: "OUTSIDE_SCOPE", contextIsValid: true });
  });

  it("não cria permissão de agenda ausente nem permite cruzar workspaces", async () => {
    const schedulerContext = { ...context, workspaceSlug: "politizai", email: "carloshenrique@politizai.com" };
    const service = createAuthorizationService({ database: {
      workspaceMember: { findFirst: vi.fn().mockResolvedValue({ id: context.memberId }) },
      actor: { findFirst: vi.fn().mockResolvedValue({ id: context.actorId }) },
      rolePermission: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never });
    await expect(service.authorize(schedulerContext, PermissionKeys.MEETINGS_READ, { workspaceId: context.workspaceId, resourceType: "MeetingAgenda" }))
      .resolves.toMatchObject({ allowed: false, reason: "MISSING_PERMISSION" });
    await expect(service.authorize(schedulerContext, PermissionKeys.MEETINGS_READ, { workspaceId: "another-workspace", resourceType: "MeetingAgenda" }))
      .resolves.toMatchObject({ allowed: false, reason: "WORKSPACE_MISMATCH" });
  });

  it.each([
    { permission: PermissionKeys.LEADS_READ, resourceType: "Lead", linked: true, allowed: true },
    { permission: PermissionKeys.LEADS_READ, resourceType: "LeadScore", linked: true, allowed: true },
    { permission: PermissionKeys.LEADS_READ, resourceType: "LeadPipeline", linked: true, allowed: true },
    { permission: PermissionKeys.TASKS_READ, resourceType: "Lead", linked: true, allowed: true },
    { permission: PermissionKeys.LEADS_READ, resourceType: "Lead", linked: false, allowed: false },
    { permission: PermissionKeys.LEADS_READ, resourceType: "LeadList", linked: true, allowed: false },
    { permission: PermissionKeys.LEADS_WRITE, resourceType: "Lead", linked: true, allowed: false },
    { permission: PermissionKeys.TASKS_WRITE, resourceType: "Lead", linked: true, allowed: false },
    { permission: PermissionKeys.LEADS_ASSIGN, resourceType: "Lead", linked: true, allowed: false },
  ])("restringe leitura do card vinculado: $permission/$resourceType/$linked", async ({ permission, resourceType, linked, allowed }) => {
    const meetingLookup = vi.fn().mockResolvedValue(linked ? { id: "meeting-1" } : null);
    const service = createAuthorizationService({ database: {
      workspaceMember: { findFirst: vi.fn().mockResolvedValue({ id: context.memberId }) },
      actor: { findFirst: vi.fn().mockResolvedValue({ id: context.actorId }) },
      rolePermission: { findFirst: vi.fn().mockResolvedValue({ scope: "OWN" }) },
      lead: { findFirst: vi.fn().mockResolvedValue(null) },
      meeting: { findFirst: meetingLookup },
    } as never });
    const scheduler = { ...context, email: "carloshenrique@politizai.com", workspaceSlug: "politizai" };
    const decision = await service.authorize(scheduler, permission, { workspaceId: context.workspaceId, resourceType, resourceId: "linked-lead", ownerMemberId: "other-member" });
    expect(decision.allowed).toBe(allowed);
    if (allowed) expect(meetingLookup).toHaveBeenCalledWith(expect.objectContaining({ where: {
      workspaceId: context.workspaceId, leadId: "linked-lead", deletedAt: null, lead: { deletedAt: null },
    } }));
  });

  it.each([
    { permission: PermissionKeys.LEADS_READ, resourceType: "Lead", advertising: true, verified: true, allowed: true },
    { permission: PermissionKeys.LEADS_WRITE, resourceType: "LeadPipeline", advertising: true, verified: true, allowed: true },
    { permission: PermissionKeys.TASKS_WRITE, resourceType: "Lead", advertising: true, verified: true, allowed: true },
    { permission: PermissionKeys.CONTACTS_READ, resourceType: "Contact", advertising: true, verified: true, allowed: true },
    { permission: PermissionKeys.LEADS_WRITE, resourceType: "Lead", advertising: false, verified: true, allowed: false },
    { permission: PermissionKeys.LEADS_ASSIGN, resourceType: "Lead", advertising: true, verified: true, allowed: false },
    { permission: PermissionKeys.LEADS_WRITE, resourceType: "Lead", advertising: true, verified: false, allowed: false },
  ])("Carlos opera somente leads de Anúncios com identidade verificada: $permission/$resourceType/$advertising/$verified", async ({ permission, resourceType, advertising, verified, allowed }) => {
    const leadLookup = vi.fn().mockResolvedValue(advertising ? { id: "lead-ad" } : null);
    const service = createAuthorizationService({ database: {
      workspaceMember: { findFirst: vi.fn().mockImplementation(async ({ where }) => where.user && !verified ? null : { id: context.memberId }) },
      actor: { findFirst: vi.fn().mockResolvedValue({ id: context.actorId }) },
      rolePermission: { findFirst: vi.fn().mockResolvedValue({ scope: "OWN" }) },
      lead: { findFirst: leadLookup }, meeting: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never });
    const scheduler = { ...context, email: "carloshenrique@politizai.com", workspaceSlug: "politizai" };
    expect((await service.authorize(scheduler, permission, { workspaceId: context.workspaceId, resourceType, resourceId: "lead-ad", ownerMemberId: "other-member" })).allowed).toBe(allowed);
    if (allowed) expect(leadLookup).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: context.workspaceId, pipeline: { workspaceId: context.workspaceId, name: "Anúncios", entityType: "LEAD", deletedAt: null } }) }));
  });

  it("mantém escopo próprio e adiciona apenas o pipeline de Anúncios às listagens do Carlos", async () => {
    const service = createAuthorizationService({ database: {
      workspaceMember: { findFirst: vi.fn().mockResolvedValue({ id: context.memberId }) },
      actor: { findFirst: vi.fn().mockResolvedValue({ id: context.actorId }) },
      rolePermission: { findFirst: vi.fn().mockResolvedValue({ scope: "OWN" }) },
      pipeline: { findMany: vi.fn().mockResolvedValue([{ id: "ads" }]) },
    } as never });
    await expect(service.authorize({ ...context, email: "carloshenrique@politizai.com", workspaceSlug: "politizai" }, PermissionKeys.LEADS_READ,
      { workspaceId: context.workspaceId, resourceType: "LeadList", memberId: context.memberId }))
      .resolves.toEqual({ allowed: true, scope: "OWN", additionalLeadPipelineIds: ["ads"] });
  });

  it("a exceção de Anúncios exige permissão-base e não cruza workspaces", async () => {
    const lookup = vi.fn().mockResolvedValue({ id: "ads-lead" });
    const service = createAuthorizationService({ database: {
      workspaceMember: { findFirst: vi.fn().mockResolvedValue({ id: context.memberId }) }, actor: { findFirst: vi.fn().mockResolvedValue({ id: context.actorId }) },
      rolePermission: { findFirst: vi.fn().mockResolvedValue(null) }, lead: { findFirst: lookup },
    } as never });
    const scheduler = { ...context, email: "carloshenrique@politizai.com", workspaceSlug: "politizai" };
    await expect(service.authorize(scheduler, PermissionKeys.LEADS_WRITE, { workspaceId: context.workspaceId, resourceType: "Lead", resourceId: "ads-lead", ownerMemberId: "other" })).resolves.toMatchObject({ allowed: false, reason: "MISSING_PERMISSION" });
    await expect(service.authorize(scheduler, PermissionKeys.LEADS_READ, { workspaceId: "foreign", resourceType: "Lead", resourceId: "ads-lead" })).resolves.toMatchObject({ allowed: false, reason: "WORKSPACE_MISMATCH" });
    expect(lookup).not.toHaveBeenCalled();
  });

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

  it("lista somente as permissões efetivas do papel autenticado", async () => {
    const rolePermissionFindMany = vi.fn().mockResolvedValue([
      { permission: { key: PermissionKeys.FINANCE_READ } },
      { permission: { key: PermissionKeys.METRICS_READ } },
    ]);
    const workspaceMemberFindFirst = vi.fn();
    const actorFindFirst = vi.fn();
    const service = createAuthorizationService({
      database: {
        workspaceMember: { findFirst: workspaceMemberFindFirst },
        actor: { findFirst: actorFindFirst },
        rolePermission: { findMany: rolePermissionFindMany },
      } as never,
    });

    await expect(service.getEffectivePermissionKeys(context)).resolves.toEqual([
      PermissionKeys.FINANCE_READ,
      PermissionKeys.METRICS_READ,
    ]);
    expect(rolePermissionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspaceId: context.workspaceId,
        roleId: context.roleId,
      }),
    }));
    expect(workspaceMemberFindFirst).not.toHaveBeenCalled();
    expect(actorFindFirst).not.toHaveBeenCalled();
  });
});
