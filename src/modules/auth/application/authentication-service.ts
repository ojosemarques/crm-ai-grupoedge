import { createHash, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  AuthenticationRequiredError,
  InvalidCredentialsError,
  SessionExpiredError,
} from "@/modules/auth/domain/auth-errors";
import {
  consumeDummyPasswordCheck,
  hashPassword,
  verifyPassword,
} from "@/modules/auth/domain/password";
import type {
  AuthenticatedContext,
  RequestMetadata,
} from "@/modules/auth/application/authenticated-context";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;

type AuthenticationServiceOptions = Readonly<{
  database: PrismaClient;
  sessionTtlHours: number;
  maxFailedAttempts: number;
  lockMinutes: number;
  now?: () => Date;
  generateToken?: () => string;
}>;

export type LoginInput = Readonly<{
  workspaceSlug: string;
  email: string;
  password: string;
  request: RequestMetadata;
}>;

export type LoginResult = Readonly<{
  token: string;
  expiresAt: Date;
  context: AuthenticatedContext;
}>;

type LoginFailureReason =
  | "ACCOUNT_LOCKED"
  | "ACTOR_MISSING"
  | "CREDENTIAL_MISSING"
  | "INVALID_PASSWORD"
  | "MEMBERSHIP_MISSING";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeWorkspaceSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashSessionToken(token: string): string {
  return hashValue(token);
}

function buildContext(session: {
  id: string;
  workspaceId: string;
  userId: string;
  workspaceMemberId: string;
  actorId: string;
  workspace: { slug: string };
  user: { displayName: string };
  member: { roleId: string; role: { key: string; name: string } };
}): AuthenticatedContext {
  return Object.freeze({
    sessionId: session.id,
    workspaceId: session.workspaceId,
    workspaceSlug: session.workspace.slug,
    userId: session.userId,
    memberId: session.workspaceMemberId,
    actorId: session.actorId,
    roleId: session.member.roleId,
    roleKey: session.member.role.key,
    roleName: session.member.role.name,
    displayName: session.user.displayName,
  });
}

async function appendAuditLog(
  transaction: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    actorId: string;
    action: string;
    entityId: string;
    changes?: Prisma.InputJsonValue;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      origin: "API",
      entityType: "AuthSession",
      entityId: input.entityId,
      ...(input.changes === undefined ? {} : { changes: input.changes }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}

export function createAuthenticationService(options: AuthenticationServiceOptions) {
  const now = options.now ?? (() => new Date());
  const generateToken =
    options.generateToken ?? (() => randomBytes(32).toString("base64url"));

  async function recordLoginFailure(input: {
    workspaceId: string;
    systemActorId: string;
    normalizedEmail: string;
    credentialId: string | undefined;
    previousFailedAttempts: number | undefined;
    reason: LoginFailureReason;
    request: RequestMetadata;
    occurredAt: Date;
  }): Promise<void> {
    await options.database.$transaction(async (transaction) => {
      if (
        input.credentialId &&
        input.previousFailedAttempts !== undefined &&
        input.reason !== "ACCOUNT_LOCKED"
      ) {
        const failedAttempts = input.previousFailedAttempts + 1;
        await transaction.localCredential.update({
          where: { id: input.credentialId },
          data: {
            failedAttempts,
            lockedUntil:
              failedAttempts >= options.maxFailedAttempts
                ? new Date(
                    input.occurredAt.getTime() + options.lockMinutes * 60_000,
                  )
                : null,
          },
        });
      }

      await appendAuditLog(transaction, {
        workspaceId: input.workspaceId,
        actorId: input.systemActorId,
        action: "auth.login.failed",
        entityId: input.workspaceId,
        changes: { outcome: "failed", reason: input.reason },
        metadata: {
          emailFingerprint: hashValue(input.normalizedEmail),
          ipAddress: input.request.ipAddress,
          userAgent: input.request.userAgent,
        },
      });
    });
  }

  async function login(input: LoginInput): Promise<LoginResult> {
    const occurredAt = now();
    const normalizedEmail = normalizeEmail(input.email);
    const workspaceSlug = normalizeWorkspaceSlug(input.workspaceSlug);
    const workspace = await options.database.workspace.findFirst({
      where: {
        slug: workspaceSlug,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true, slug: true },
    });

    if (!workspace) {
      await consumeDummyPasswordCheck(input.password);
      throw new InvalidCredentialsError();
    }

    const [membership, systemActor] = await Promise.all([
      options.database.workspaceMember.findFirst({
        where: {
          workspaceId: workspace.id,
          status: "ACTIVE",
          deletedAt: null,
          role: { deletedAt: null },
          user: {
            normalizedEmail,
            status: "ACTIVE",
            deletedAt: null,
          },
        },
        include: {
          role: true,
          user: { include: { credential: true } },
          workspace: true,
        },
      }),
      options.database.actor.findFirst({
        where: {
          workspaceId: workspace.id,
          type: "SYSTEM",
          key: "system",
        },
        select: { id: true },
      }),
    ]);

    const credential = membership?.user.credential;
    const humanActor = membership
      ? await options.database.actor.findFirst({
          where: {
            workspaceId: workspace.id,
            userId: membership.userId,
            type: "HUMAN",
          },
          select: { id: true },
        })
      : null;

    const passwordMatches = credential
      ? await verifyPassword(input.password, credential.passwordHash)
      : (await consumeDummyPasswordCheck(input.password), false);
    const isLocked = Boolean(
      credential?.lockedUntil && credential.lockedUntil > occurredAt,
    );

    if (!membership || !credential || !humanActor || !passwordMatches || isLocked) {
      if (systemActor) {
        const reason: LoginFailureReason = !membership
          ? "MEMBERSHIP_MISSING"
          : !credential
            ? "CREDENTIAL_MISSING"
            : !humanActor
              ? "ACTOR_MISSING"
              : isLocked
                ? "ACCOUNT_LOCKED"
                : "INVALID_PASSWORD";

        await recordLoginFailure({
          workspaceId: workspace.id,
          systemActorId: systemActor.id,
          normalizedEmail,
          credentialId: credential?.id,
          previousFailedAttempts: credential?.failedAttempts,
          reason,
          request: input.request,
          occurredAt,
        });
      }

      throw new InvalidCredentialsError();
    }

    const token = generateToken();
    const expiresAt = new Date(
      occurredAt.getTime() + options.sessionTtlHours * 60 * 60_000,
    );

    const session = await options.database.$transaction(async (transaction) => {
      await transaction.localCredential.update({
        where: { id: credential.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });

      const createdSession = await transaction.authSession.create({
        data: {
          workspaceId: workspace.id,
          userId: membership.userId,
          workspaceMemberId: membership.id,
          actorId: humanActor.id,
          tokenHash: hashSessionToken(token),
          credentialVersion: credential.credentialVersion,
          expiresAt,
          lastSeenAt: occurredAt,
          createdAt: occurredAt,
          ipAddress: input.request.ipAddress,
          userAgent: input.request.userAgent,
        },
        include: {
          workspace: true,
          user: true,
          member: { include: { role: true } },
        },
      });

      await appendAuditLog(transaction, {
        workspaceId: workspace.id,
        actorId: humanActor.id,
        action: "auth.login.succeeded",
        entityId: createdSession.id,
        changes: { outcome: "succeeded" },
        metadata: {
          ipAddress: input.request.ipAddress,
          userAgent: input.request.userAgent,
        },
      });

      return createdSession;
    });

    return {
      token,
      expiresAt,
      context: buildContext(session),
    };
  }

  async function expireSession(
    session: {
      id: string;
      workspaceId: string;
      actorId: string;
      revokedAt: Date | null;
    },
    action: "auth.session.expired" | "auth.session.invalidated",
    occurredAt: Date,
  ): Promise<void> {
    if (session.revokedAt) {
      return;
    }

    await options.database.$transaction(async (transaction) => {
      const revoked = await transaction.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: occurredAt },
      });

      if (revoked.count === 1) {
        await appendAuditLog(transaction, {
          workspaceId: session.workspaceId,
          actorId: session.actorId,
          action,
          entityId: session.id,
          changes: { revokedAt: occurredAt.toISOString() },
        });
      }
    });
  }

  async function validateSession(token: string | undefined): Promise<AuthenticatedContext> {
    if (!token) {
      throw new AuthenticationRequiredError();
    }

    const session = await options.database.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: {
        workspace: true,
        user: { include: { credential: true } },
        member: { include: { role: true } },
        actor: true,
      },
    });

    if (!session) {
      throw new AuthenticationRequiredError();
    }

    const occurredAt = now();
    const structurallyInvalid =
      session.workspace.status !== "ACTIVE" ||
      session.workspace.deletedAt !== null ||
      session.user.status !== "ACTIVE" ||
      session.user.deletedAt !== null ||
      session.member.status !== "ACTIVE" ||
      session.member.deletedAt !== null ||
      session.member.role.deletedAt !== null ||
      session.actor.type !== "HUMAN" ||
      session.actor.userId !== session.userId ||
      !session.user.credential ||
      session.user.credential.credentialVersion !== session.credentialVersion;

    if (session.revokedAt || session.expiresAt <= occurredAt || structurallyInvalid) {
      await expireSession(
        session,
        session.expiresAt <= occurredAt
          ? "auth.session.expired"
          : "auth.session.invalidated",
        occurredAt,
      );
      throw new SessionExpiredError();
    }

    if (
      occurredAt.getTime() - session.lastSeenAt.getTime() >=
      LAST_SEEN_WRITE_INTERVAL_MS
    ) {
      await options.database.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: occurredAt },
      });
    }

    return buildContext(session);
  }

  async function logout(token: string | undefined): Promise<boolean> {
    if (!token) {
      return false;
    }

    const session = await options.database.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: {
        id: true,
        workspaceId: true,
        actorId: true,
        revokedAt: true,
      },
    });

    if (!session || session.revokedAt) {
      return false;
    }

    const occurredAt = now();
    await options.database.$transaction(async (transaction) => {
      await transaction.authSession.update({
        where: { id: session.id },
        data: { revokedAt: occurredAt },
      });
      await appendAuditLog(transaction, {
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        action: "auth.logout",
        entityId: session.id,
        changes: { revokedAt: occurredAt.toISOString() },
      });
    });

    return true;
  }

  async function changePassword(
    context: AuthenticatedContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (
      newPassword.length < 16 ||
      newPassword.length > 128 ||
      !/[a-z]/.test(newPassword) ||
      !/[A-Z]/.test(newPassword) ||
      !/\d/.test(newPassword) ||
      !/[^A-Za-z0-9]/.test(newPassword)
    ) {
      throw new ApplicationError("A nova senha deve ter de 16 a 128 caracteres, com maiúscula, minúscula, número e símbolo.", {
        code: "PASSWORD_POLICY_VIOLATION", statusCode: 400, expose: true,
      });
    }

    const credential = await options.database.localCredential.findUnique({
      where: { userId: context.userId },
      select: { id: true, passwordHash: true, credentialVersion: true },
    });
    if (!credential || !await verifyPassword(currentPassword, credential.passwordHash)) {
      throw new ApplicationError("Senha atual incorreta.", {
        code: "CURRENT_PASSWORD_INVALID", statusCode: 400, expose: true,
      });
    }
    if (await verifyPassword(newPassword, credential.passwordHash)) {
      throw new ApplicationError("Escolha uma senha diferente da atual.", {
        code: "PASSWORD_UNCHANGED", statusCode: 400, expose: true,
      });
    }

    const passwordHash = await hashPassword(newPassword);
    const occurredAt = now();
    await options.database.$transaction(async (transaction) => {
      const updated = await transaction.localCredential.updateMany({
        where: { id: credential.id, credentialVersion: credential.credentialVersion },
        data: {
          passwordHash,
          credentialVersion: { increment: 1 },
          passwordChangedAt: occurredAt,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      if (updated.count !== 1) throw new SessionExpiredError();

      await transaction.authSession.updateMany({
        where: { userId: context.userId, revokedAt: null },
        data: { revokedAt: occurredAt },
      });
      await appendAuditLog(transaction, {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        action: "auth.password.changed",
        entityId: context.sessionId,
        changes: { sessionsRevoked: true },
      });
    });
  }

  return Object.freeze({ login, validateSession, logout, changePassword });
}

let authenticationService:
  | ReturnType<typeof createAuthenticationService>
  | undefined;

export function getAuthenticationService(): ReturnType<
  typeof createAuthenticationService
> {
  if (authenticationService) {
    return authenticationService;
  }

  const config = getApplicationConfig();
  authenticationService = createAuthenticationService({
    database: getDatabaseClient(),
    sessionTtlHours: config.AUTH_SESSION_TTL_HOURS,
    maxFailedAttempts: config.AUTH_MAX_FAILED_ATTEMPTS,
    lockMinutes: config.AUTH_LOCK_MINUTES,
  });

  return authenticationService;
}
