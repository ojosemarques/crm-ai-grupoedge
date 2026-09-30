import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { ensureProductionFoundationInTransaction } from "@/modules/settings/application/production-foundation-service";
import { defaultRoleDefinitions } from "@/modules/users/permissions/default-role-definitions";
import { PermissionKeys, permissionCatalog } from "@/modules/users/permissions/permission-keys";
import { companyHubCommandSchema, type CompanyHubScreen } from "@/modules/users/domain/company-hub-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const activeMembership = { status: "ACTIVE", deletedAt: null, user: { status: "ACTIVE", deletedAt: null }, workspace: { status: "ACTIVE", deletedAt: null }, role: { deletedAt: null } } as const;
const adminPermissions = [PermissionKeys.WORKSPACE_MANAGE, PermissionKeys.WORKSPACE_MEMBERS_MANAGE, PermissionKeys.WORKSPACE_PERMISSIONS_MANAGE];
function denied(): never { throw new ApplicationError("Esta ação exige administração das empresas envolvidas.", { code: "COMPANY_ADMIN_REQUIRED", statusCode: 403, expose: true }); }
function conflict(message: string): never { throw new ApplicationError(message, { code: "COMPANY_CONFLICT", statusCode: 409, expose: true }); }

export function createCompanyHubService(database: PrismaClient) {
  async function assertAdministrator(tx: Prisma.TransactionClient, context: AuthenticatedContext, workspaceId: string) {
    const member = await tx.workspaceMember.findFirst({ where: { ...activeMembership, workspaceId, userId: context.userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } } });
    if (!member || member.role.key !== "administrator" || !adminPermissions.every(key => member.role.permissions.some(grant => grant.permission.key === key && grant.scope === "WORKSPACE"))) denied();
    const actor = await tx.actor.findFirst({ where: { workspaceId, userId: context.userId, type: "HUMAN" } });
    if (!actor) denied();
    return { member, actor };
  }

  async function screen(context: AuthenticatedContext): Promise<CompanyHubScreen> {
    const memberships = await database.workspaceMember.findMany({ where: { ...activeMembership, userId: context.userId },
      include: { workspace: true, role: { include: { permissions: { include: { permission: true } } } } },
      orderBy: [{ workspace: { name: "asc" } }, { id: "asc" }] });
    const companies = await Promise.all(memberships.map(async member => {
      const canManage = member.role.key === "administrator" && adminPermissions.every(key => member.role.permissions.some(grant => grant.permission.key === key && grant.scope === "WORKSPACE"));
      const roles = canManage ? await database.role.findMany({ where: { workspaceId: member.workspaceId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
      const members = canManage ? await database.workspaceMember.findMany({ where: { ...activeMembership, workspaceId: member.workspaceId }, select: { id: true, user: { select: { displayName: true, email: true } } }, orderBy: { user: { displayName: "asc" } } }) : [];
      return { id: member.workspaceId, name: member.workspace.name, slug: member.workspace.slug, roleName: member.role.name, canManage, roles, members: members.map(m => ({ id: m.id, name: m.user.displayName, email: m.user.email })) };
    }));
    return { displayName: context.displayName, currentWorkspaceId: context.workspaceId, canCreate: companies.some(c => c.id === context.workspaceId && c.canManage), companies };
  }

  async function execute(context: AuthenticatedContext, raw: unknown) {
    const input = companyHubCommandSchema.parse(raw);
    return database.$transaction(async tx => {
      // Revalidate the live session and membership inside the write transaction.
      const session = await tx.authSession.findFirst({ where: { id: context.sessionId, userId: context.userId, workspaceId: context.workspaceId, revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: { include: { credential: true } } } });
      if (!session || session.user.status !== "ACTIVE" || session.user.deletedAt || session.user.credential?.credentialVersion !== session.credentialVersion) denied();
      await assertAdministrator(tx, context, context.workspaceId);

      if (input.action === "CREATE_COMPANY") {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-create:${input.slug}`}))`;
        const existing = await tx.workspace.findUnique({ where: { slug: input.slug } });
        if (existing) {
          const receipt = await tx.auditLog.findFirst({ where: { workspaceId: existing.id, action: "company.created", metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } } });
          const metadata = receipt?.metadata as Record<string, unknown> | null;
          if (receipt && metadata?.userId === context.userId && existing.name === input.name && existing.deletedAt === null && existing.status === "ACTIVE") return { workspaceId: existing.id, created: false };
          conflict("Este identificador já está em uso. Escolha outro para a empresa.");
        }
        const workspace = await tx.workspace.create({ data: { name: input.name, slug: input.slug, timeZone: "America/Sao_Paulo" } });
        const system = await tx.actor.create({ data: { workspaceId: workspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" } });
        const auditFields = { workspaceId: workspace.id, createdByActorId: system.id, updatedByActorId: system.id };
        await tx.permission.createMany({ data: [...permissionCatalog], skipDuplicates: true });
        const permissions = await tx.permission.findMany({ where: { key: { in: permissionCatalog.map(p => p.key) } } });
        const permissionIds = new Map(permissions.map(p => [p.key, p.id]));
        let administratorId = "";
        for (const definition of defaultRoleDefinitions) {
          const role = await tx.role.create({ data: { ...auditFields, key: definition.key, name: definition.name, description: definition.description, isSystem: true } });
          if (role.key === "administrator") administratorId = role.id;
          await tx.rolePermission.createMany({ data: definition.grants.map(([key, scope]) => ({ workspaceId: workspace.id, roleId: role.id, permissionId: permissionIds.get(key)!, scope, createdByActorId: system.id })), skipDuplicates: true });
        }
        await tx.workspaceMember.create({ data: { ...auditFields, userId: context.userId, roleId: administratorId, status: "ACTIVE", joinedAt: new Date() } });
        const actor = await tx.actor.create({ data: { workspaceId: workspace.id, userId: context.userId, type: "HUMAN", key: `user:${context.userId}`, displayName: context.displayName } });
        await tx.actor.createMany({ data: [
          { workspaceId: workspace.id, type: "AUTOMATION", key: "automation:local", displayName: "Automações" },
          { workspaceId: workspace.id, type: "AI_AGENT", key: "ai:recommendation", displayName: "Assistente" },
        ] });
        await ensureProductionFoundationInTransaction(tx, workspace.slug);
        await tx.queue.create({ data: { ...auditFields, key: "general", name: "Fila geral", isGeneral: true } });
        await tx.leadSource.createMany({ data: [
          { ...auditFields, key: "manual", name: "Cadastro manual", type: "MANUAL" },
          { ...auditFields, key: "form", name: "Formulário", type: "FORM" },
          { ...auditFields, key: "referral", name: "Indicação", type: "REFERRAL" },
        ] });
        await tx.financialCategory.createMany({ data: [
          { ...auditFields, key: "operating_revenue", name: "Receita operacional", kind: "INCOME", dreGroup: "RECEITA_BRUTA" },
          { ...auditFields, key: "operating_expense", name: "Despesas operacionais", kind: "EXPENSE", dreGroup: "DESPESAS_OPERACIONAIS" },
          { ...auditFields, key: "advertising", name: "Anúncios", kind: "EXPENSE", dreGroup: "DESPESAS_OPERACIONAIS" },
        ] });
        await tx.financialAccount.create({ data: { ...auditFields, name: "Caixa", type: "CASH", openingBalanceCents: 0 } });
        await tx.auditLog.create({ data: { workspaceId: workspace.id, actorId: actor.id, action: "company.created", entityType: "Workspace", entityId: workspace.id, origin: "API", metadata: { idempotencyKey: input.idempotencyKey, userId: context.userId }, changes: { name: input.name, slug: input.slug } } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "company.creation.requested", entityType: "Workspace", entityId: context.workspaceId, origin: "API", changes: { createdWorkspaceId: workspace.id } } });
        return { workspaceId: workspace.id, created: true };
      }

      if (input.sourceWorkspaceId === input.targetWorkspaceId) conflict("Escolha duas empresas diferentes.");
      await assertAdministrator(tx, context, input.sourceWorkspaceId);
      const { actor } = await assertAdministrator(tx, context, input.targetWorkspaceId);
      const source = await tx.workspaceMember.findFirst({ where: { ...activeMembership, id: input.memberId, workspaceId: input.sourceWorkspaceId }, include: { user: true } });
      const role = await tx.role.findFirst({ where: { id: input.roleId, workspaceId: input.targetWorkspaceId, deletedAt: null } });
      if (!source || !role) denied();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-access:${input.targetWorkspaceId}:${source.userId}`}))`;
      const existing = await tx.workspaceMember.findFirst({ where: { workspaceId: input.targetWorkspaceId, userId: source.userId } });
      if (existing) {
        if (existing.status === "ACTIVE" && !existing.deletedAt && existing.roleId === role.id) return { workspaceId: input.targetWorkspaceId, created: false };
        conflict("Este usuário já tem vínculo com a empresa. Altere o papel ou reative o acesso em Pessoas e equipes dessa empresa.");
      }
      const member = await tx.workspaceMember.create({ data: { workspaceId: input.targetWorkspaceId, userId: source.userId, roleId: role.id, status: "ACTIVE", joinedAt: new Date(), createdByActorId: actor.id, updatedByActorId: actor.id } });
      await tx.actor.create({ data: { workspaceId: input.targetWorkspaceId, userId: source.userId, type: "HUMAN", key: `user:${source.userId}`, displayName: source.user.displayName } });
      await tx.auditLog.create({ data: { workspaceId: input.targetWorkspaceId, actorId: actor.id, action: "company.access.granted", entityType: "WorkspaceMember", entityId: member.id, origin: "API", changes: { roleId: role.id, userId: source.userId } } });
      return { workspaceId: input.targetWorkspaceId, created: true };
    }, { maxWait: 10000, timeout: 90000 });
  }
  return { screen, execute };
}
let singleton: ReturnType<typeof createCompanyHubService> | undefined;
export function getCompanyHubService() { return singleton ??= createCompanyHubService(getDatabaseClient()); }
