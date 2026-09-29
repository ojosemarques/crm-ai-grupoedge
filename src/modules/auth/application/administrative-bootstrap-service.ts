import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/modules/auth/domain/password";
import { AccessRoleKeys, permissionCatalog } from "@/modules/users/permissions/permission-keys";
import { loadEnvironmentContract } from "@/shared/core/config/environment-contract";
import { ApplicationError, ConfigurationError } from "@/shared/core/errors/application-error";

const BOOTSTRAP_ACTION = "system.admin_bootstrap.completed";
const BOOTSTRAP_CONFIRMATION = "CREATE_INITIAL_ADMIN";
const DEFAULT_PASSWORDS = new Set([
  "politizai#local2026",
  "politizai@local123",
  "password123456",
  "senha12345678",
]);

export type AdministrativeBootstrapInput = Readonly<{
  workspaceSlug: string;
  workspaceName: string;
  adminEmail: string;
  adminDisplayName: string;
  adminPassword: string;
  idempotencyKey: string;
}>;

export type AdministrativeBootstrapResult = Readonly<{
  status: "CREATED" | "ALREADY_COMPLETED";
  workspaceId: string;
  userId: string;
  memberId: string;
}>;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function validateInput(input: AdministrativeBootstrapInput): AdministrativeBootstrapInput {
  const normalizedEmail = input.adminEmail.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(input.workspaceSlug)) fail("Slug do workspace inválido.", "BOOTSTRAP_INPUT_INVALID", 400);
  if (!normalizedEmail.includes("@") || normalizedEmail.length > 320) fail("E-mail administrativo inválido.", "BOOTSTRAP_INPUT_INVALID", 400);
  if (input.workspaceName.trim().length < 2 || input.adminDisplayName.trim().length < 2) fail("Identificação administrativa inválida.", "BOOTSTRAP_INPUT_INVALID", 400);
  if (input.idempotencyKey.length < 24 || input.idempotencyKey.length > 200) fail("Chave de idempotência inválida.", "BOOTSTRAP_INPUT_INVALID", 400);
  if (
    input.adminPassword.length < 16 ||
    input.adminPassword.length > 128 ||
    !/[a-z]/.test(input.adminPassword) ||
    !/[A-Z]/.test(input.adminPassword) ||
    !/\d/.test(input.adminPassword) ||
    !/[^A-Za-z0-9]/.test(input.adminPassword) ||
    DEFAULT_PASSWORDS.has(input.adminPassword.toLowerCase())
  ) fail("A senha inicial não atende à política de bootstrap.", "BOOTSTRAP_PASSWORD_UNSAFE", 400);
  return { ...input, adminEmail: normalizedEmail, workspaceName: input.workspaceName.trim(), adminDisplayName: input.adminDisplayName.trim() };
}

export function parseAdministrativeBootstrapEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): AdministrativeBootstrapInput {
  const contract = loadEnvironmentContract(source);
  const required = [
    "ADMIN_BOOTSTRAP_SECRET",
    "ADMIN_BOOTSTRAP_CONFIRMATION",
    "ADMIN_BOOTSTRAP_IDEMPOTENCY_KEY",
    "ADMIN_BOOTSTRAP_WORKSPACE_SLUG",
    "ADMIN_BOOTSTRAP_WORKSPACE_NAME",
    "ADMIN_BOOTSTRAP_EMAIL",
    "ADMIN_BOOTSTRAP_DISPLAY_NAME",
    "ADMIN_BOOTSTRAP_PASSWORD",
  ].filter((name) => !source[name]?.trim());
  if (
    required.length > 0 ||
    !contract.isRemote ||
    contract.PROCESS_ROLE !== "bootstrap" ||
    contract.ADMIN_BOOTSTRAP_ENABLED !== "true" ||
    source.ADMIN_BOOTSTRAP_CONFIRMATION !== BOOTSTRAP_CONFIRMATION ||
    (source.ADMIN_BOOTSTRAP_SECRET?.length ?? 0) < 32
  ) {
    throw new ConfigurationError(required.length > 0 ? required : ["ADMIN_BOOTSTRAP_CONFIGURATION"]);
  }
  return validateInput({
    workspaceSlug: source.ADMIN_BOOTSTRAP_WORKSPACE_SLUG!,
    workspaceName: source.ADMIN_BOOTSTRAP_WORKSPACE_NAME!,
    adminEmail: source.ADMIN_BOOTSTRAP_EMAIL!,
    adminDisplayName: source.ADMIN_BOOTSTRAP_DISPLAY_NAME!,
    adminPassword: source.ADMIN_BOOTSTRAP_PASSWORD!,
    idempotencyKey: source.ADMIN_BOOTSTRAP_IDEMPOTENCY_KEY!,
  });
}

export function createAdministrativeBootstrapService(database: PrismaClient) {
  return Object.freeze({
    async execute(rawInput: AdministrativeBootstrapInput): Promise<AdministrativeBootstrapResult> {
      const input = validateInput(rawInput);
      const idempotencyFingerprint = digest(input.idempotencyKey);
      const identityFingerprint = digest(input.adminEmail);

      return database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('politizai_crm_admin_bootstrap_v1'))`;
        const workspace = await transaction.workspace.findUnique({ where: { slug: input.workspaceSlug } });
        if (workspace) {
          const marker = await transaction.auditLog.findFirst({
            where: { workspaceId: workspace.id, action: BOOTSTRAP_ACTION, entityType: "Workspace", entityId: workspace.id },
            orderBy: { occurredAt: "asc" },
          });
          const metadata = marker?.metadata && typeof marker.metadata === "object" && !Array.isArray(marker.metadata)
            ? marker.metadata as Record<string, unknown>
            : {};
          if (marker && metadata.idempotencyFingerprint === idempotencyFingerprint && metadata.identityFingerprint === identityFingerprint) {
            const user = await transaction.user.findUniqueOrThrow({ where: { normalizedEmail: input.adminEmail } });
            const member = await transaction.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: user.id } });
            return { status: "ALREADY_COMPLETED", workspaceId: workspace.id, userId: user.id, memberId: member.id };
          }
          fail("O bootstrap administrativo já foi consumido ou o workspace já existe.", "ADMIN_BOOTSTRAP_ALREADY_CONSUMED");
        }

        if (await transaction.workspace.count() > 0 || await transaction.user.count() > 0 || await transaction.workspaceMember.count() > 0) {
          fail("O bootstrap inicial exige uma base sem workspaces e usuários.", "ADMIN_BOOTSTRAP_DATABASE_NOT_EMPTY");
        }

        const createdWorkspace = await transaction.workspace.create({
          data: { slug: input.workspaceSlug, name: input.workspaceName, timeZone: "America/Sao_Paulo" },
        });
        const systemActor = await transaction.actor.create({
          data: { workspaceId: createdWorkspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" },
        });
        const role = await transaction.role.create({
          data: {
            workspaceId: createdWorkspace.id,
            key: AccessRoleKeys.ADMINISTRATOR,
            name: "Administrador",
            description: "Administração completa do workspace.",
            isSystem: true,
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });
        await transaction.permission.createMany({ data: [...permissionCatalog], skipDuplicates: true });
        const permissions = await transaction.permission.findMany({
          where: { key: { in: permissionCatalog.map(({ key }) => key) } },
          select: { id: true },
        });
        if (permissions.length !== permissionCatalog.length) {
          fail("Catálogo de permissões incompleto durante o bootstrap.", "ADMIN_BOOTSTRAP_PERMISSIONS_INCOMPLETE");
        }
        await transaction.rolePermission.createMany({
          data: permissions.map(({ id }) => ({
            workspaceId: createdWorkspace.id,
            roleId: role.id,
            permissionId: id,
            scope: "WORKSPACE",
            createdByActorId: systemActor.id,
          })),
        });
        const user = await transaction.user.create({
          data: { email: input.adminEmail, normalizedEmail: input.adminEmail, displayName: input.adminDisplayName },
        });
        await transaction.localCredential.create({ data: { userId: user.id, passwordHash: await hashPassword(input.adminPassword) } });
        const member = await transaction.workspaceMember.create({
          data: {
            workspaceId: createdWorkspace.id,
            userId: user.id,
            roleId: role.id,
            status: "ACTIVE",
            joinedAt: new Date(),
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });
        await transaction.actor.create({
          data: { workspaceId: createdWorkspace.id, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: input.adminDisplayName },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: createdWorkspace.id,
            actorId: systemActor.id,
            action: BOOTSTRAP_ACTION,
            entityType: "Workspace",
            entityId: createdWorkspace.id,
            origin: "SYSTEM",
            reason: "Bootstrap administrativo inicial concluído.",
            metadata: { contractVersion: "prod03.1", idempotencyFingerprint, identityFingerprint, permissionCount: permissionCatalog.length },
          },
        });
        return { status: "CREATED", workspaceId: createdWorkspace.id, userId: user.id, memberId: member.id };
      }, {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 30_000,
      });
    },
  });
}
