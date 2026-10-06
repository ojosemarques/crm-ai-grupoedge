import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  POLITIZAI_MCP_CLIENT_ID,
  POLITIZAI_MCP_REDIRECT_URI,
  getPolitizaiMcpPublicConfig,
  getPolitizaiMcpSigningSecret,
  normalizeMcpScopes,
} from "@/modules/prospecting/domain/politizai-mcp-config";
import { getDatabaseClient } from "@/shared/core/database/client";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60_000;
const REFRESH_TOKEN_TTL_MS = 30 * 86_400_000;

const codeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const stateSchema = z.string().min(1).max(2_048);
const codeVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);

const authorizationRequestSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.literal(POLITIZAI_MCP_CLIENT_ID),
  redirect_uri: z.literal(POLITIZAI_MCP_REDIRECT_URI),
  code_challenge: codeChallengeSchema,
  code_challenge_method: z.literal("S256"),
  state: stateSchema,
  resource: z.string().url(),
  scope: z.string().max(500).optional(),
}).strict();

const accessClaimsSchema = z.object({
  iss: z.string().url(),
  aud: z.string().url(),
  sub: z.string().uuid(),
  client_id: z.literal(POLITIZAI_MCP_CLIENT_ID),
  workspace_id: z.string().uuid(),
  member_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  scope: z.string().min(1),
  iat: z.number().int(),
  nbf: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(16).max(200),
}).strict();

export type McpAuthorizationRequest = Readonly<z.infer<typeof authorizationRequestSchema> & { scopes: string[] }>;

type OAuthServiceOptions = Readonly<{
  database: PrismaClient;
  now: () => Date;
  generateOpaqueToken: () => string;
  signingSecret: () => string;
}>;

type TokenIdentity = Readonly<{
  workspaceId: string;
  userId: string;
  workspaceMemberId: string;
  authorizingActorId: string;
  clientId: string;
  resource: string;
  scopes: string[];
}>;

export type McpAuthExtra = Readonly<{
  workspaceId: string;
  userId: string;
  memberId: string;
  authorizingActorId: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function invalidToken(): never {
  throw new OAuthError(OAuthErrorCode.InvalidToken, "Token de acesso inválido.");
}

function invalidGrant(): never {
  throw new OAuthError(OAuthErrorCode.InvalidGrant, "Concessão OAuth inválida ou expirada.");
}

function safeSignatureMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function signAccessToken(secret: string, identity: TokenIdentity, now: Date): { token: string; expiresAt: number } {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAt = issuedAt + ACCESS_TOKEN_TTL_SECONDS;
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: getPolitizaiMcpPublicConfig().issuer.href.replace(/\/$/, ""),
    aud: identity.resource,
    sub: identity.userId,
    client_id: identity.clientId,
    workspace_id: identity.workspaceId,
    member_id: identity.workspaceMemberId,
    actor_id: identity.authorizingActorId,
    scope: identity.scopes.join(" "),
    iat: issuedAt,
    nbf: issuedAt - 5,
    exp: expiresAt,
    jti: randomBytes(18).toString("base64url"),
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return { token: `${unsigned}.${signature}`, expiresAt };
}

function verifySignedAccessToken(secret: string, token: string, now: Date) {
  const parts = token.split(".");
  if (parts.length !== 3) invalidToken();
  const [header, payload, signature] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  if (!safeSignatureMatches(expected, signature)) invalidToken();
  try {
    const parsedHeader = z.object({ alg: z.literal("HS256"), typ: z.literal("JWT") }).strict().parse(JSON.parse(Buffer.from(header, "base64url").toString("utf8")));
    void parsedHeader;
    const claims = accessClaimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const config = getPolitizaiMcpPublicConfig();
    if (
      claims.iss !== config.issuer.href.replace(/\/$/, "")
      || claims.aud !== config.resource.href
      || claims.nbf > nowSeconds + 30
      || claims.iat > nowSeconds + 30
      || claims.exp <= nowSeconds
      || claims.exp - claims.iat > ACCESS_TOKEN_TTL_SECONDS + 5
    ) invalidToken();
    return claims;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    invalidToken();
  }
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function appendAuditLog(
  database: Prisma.TransactionClient,
  input: Readonly<{ workspaceId: string; actorId: string; action: string; entityType: string; entityId: string; metadata?: Prisma.InputJsonValue }>,
) {
  await database.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      origin: "API",
      entityType: input.entityType,
      entityId: input.entityId,
      changes: { outcome: "succeeded" },
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}

export function createPolitizaiMcpOAuthService(options: OAuthServiceOptions) {
  function parseAuthorizationRequest(raw: Record<string, string>): McpAuthorizationRequest {
    const parsed = authorizationRequestSchema.parse(raw);
    const config = getPolitizaiMcpPublicConfig();
    if (parsed.resource !== config.resource.href) {
      throw new OAuthError(OAuthErrorCode.InvalidTarget, "Recurso OAuth inválido.");
    }
    return Object.freeze({ ...parsed, scopes: normalizeMcpScopes(parsed.scope) });
  }

  async function createAuthorizationCode(context: AuthenticatedContext, request: McpAuthorizationRequest): Promise<string> {
    const code = options.generateOpaqueToken();
    const now = options.now();
    const created = await options.database.$transaction(async (transaction) => {
      const row = await transaction.mcpOAuthAuthorizationCode.create({
        data: {
          workspaceId: context.workspaceId,
          userId: context.userId,
          workspaceMemberId: context.memberId,
          authorizingActorId: context.actorId,
          clientId: request.client_id,
          redirectUri: request.redirect_uri,
          resource: request.resource,
          scope: request.scopes.join(" "),
          codeHash: sha256(code),
          codeChallenge: request.code_challenge,
          expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS),
        },
      });
      await appendAuditLog(transaction, {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        action: "mcp.oauth.authorization_code.issued",
        entityType: "McpOAuthAuthorizationCode",
        entityId: row.id,
        metadata: { clientId: request.client_id, scopes: request.scopes, resource: request.resource },
      });
      return row;
    });
    void created;
    return code;
  }

  async function issueTokenPair(transaction: Prisma.TransactionClient, identity: TokenIdentity, actorId: string) {
    const now = options.now();
    const refreshToken = options.generateOpaqueToken();
    const refresh = await transaction.mcpOAuthRefreshToken.create({
      data: {
        workspaceId: identity.workspaceId,
        userId: identity.userId,
        workspaceMemberId: identity.workspaceMemberId,
        authorizingActorId: identity.authorizingActorId,
        clientId: identity.clientId,
        resource: identity.resource,
        scope: identity.scopes.join(" "),
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      },
    });
    const access = signAccessToken(options.signingSecret(), identity, now);
    await appendAuditLog(transaction, {
      workspaceId: identity.workspaceId,
      actorId,
      action: "mcp.oauth.token.issued",
      entityType: "McpOAuthRefreshToken",
      entityId: refresh.id,
      metadata: { clientId: identity.clientId, scopes: identity.scopes, resource: identity.resource },
    });
    return {
      access_token: access.token,
      token_type: "Bearer" as const,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: identity.scopes.join(" "),
    };
  }

  async function exchangeAuthorizationCode(input: Readonly<{
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
    resource: string;
  }>) {
    const codeVerifier = codeVerifierSchema.safeParse(input.codeVerifier);
    if (!codeVerifier.success || input.clientId !== POLITIZAI_MCP_CLIENT_ID || input.redirectUri !== POLITIZAI_MCP_REDIRECT_URI) invalidGrant();
    const config = getPolitizaiMcpPublicConfig();
    if (input.resource !== config.resource.href) invalidGrant();
    return options.database.$transaction(async (transaction) => {
      const codeHash = sha256(input.code);
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp-oauth-code:${codeHash}`}, 0))`;
      const row = await transaction.mcpOAuthAuthorizationCode.findUnique({ where: { codeHash } });
      const now = options.now();
      if (
        !row || row.consumedAt || row.expiresAt <= now
        || row.clientId !== input.clientId || row.redirectUri !== input.redirectUri || row.resource !== input.resource
        || !safeSignatureMatches(row.codeChallenge, pkceChallenge(codeVerifier.data))
      ) invalidGrant();
      const active = await transaction.workspaceMember.findFirst({
        where: {
          id: row.workspaceMemberId,
          workspaceId: row.workspaceId,
          userId: row.userId,
          status: "ACTIVE",
          deletedAt: null,
          user: { status: "ACTIVE", deletedAt: null },
          workspace: { status: "ACTIVE", deletedAt: null },
        },
        select: { id: true },
      });
      if (!active) invalidGrant();
      await transaction.mcpOAuthAuthorizationCode.update({ where: { id: row.id }, data: { consumedAt: now } });
      return issueTokenPair(transaction, {
        workspaceId: row.workspaceId,
        userId: row.userId,
        workspaceMemberId: row.workspaceMemberId,
        authorizingActorId: row.authorizingActorId,
        clientId: row.clientId,
        resource: row.resource,
        scopes: row.scope.split(" "),
      }, row.authorizingActorId);
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  async function refreshAccessToken(input: Readonly<{ refreshToken: string; clientId: string; resource: string; scope?: string }>) {
    if (input.clientId !== POLITIZAI_MCP_CLIENT_ID || input.resource !== getPolitizaiMcpPublicConfig().resource.href) invalidGrant();
    return options.database.$transaction(async (transaction) => {
      const tokenHash = sha256(input.refreshToken);
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp-oauth-refresh:${tokenHash}`}, 0))`;
      const row = await transaction.mcpOAuthRefreshToken.findUnique({ where: { tokenHash } });
      const now = options.now();
      if (!row || row.revokedAt || row.expiresAt <= now || row.clientId !== input.clientId || row.resource !== input.resource) invalidGrant();
      const grantedScopes = row.scope.split(" ");
      const requestedScopes = input.scope ? normalizeMcpScopes(input.scope) : grantedScopes;
      if (requestedScopes.some((scope) => !grantedScopes.includes(scope))) {
        throw new OAuthError(OAuthErrorCode.InvalidScope, "O refresh token não possui o escopo solicitado.");
      }
      const active = await transaction.workspaceMember.findFirst({
        where: { id: row.workspaceMemberId, workspaceId: row.workspaceId, userId: row.userId, status: "ACTIVE", deletedAt: null, user: { status: "ACTIVE", deletedAt: null }, workspace: { status: "ACTIVE", deletedAt: null } },
        select: { id: true },
      });
      if (!active) invalidGrant();
      const next = await issueTokenPair(transaction, {
        workspaceId: row.workspaceId,
        userId: row.userId,
        workspaceMemberId: row.workspaceMemberId,
        authorizingActorId: row.authorizingActorId,
        clientId: row.clientId,
        resource: row.resource,
        scopes: requestedScopes,
      }, row.authorizingActorId);
      const rotated = await transaction.mcpOAuthRefreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(next.refresh_token) }, select: { id: true } });
      await transaction.mcpOAuthRefreshToken.update({ where: { id: row.id }, data: { revokedAt: now, lastUsedAt: now, rotatedToId: rotated.id } });
      return next;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  async function revokeRefreshToken(token: string, clientId: string) {
    if (clientId !== POLITIZAI_MCP_CLIENT_ID) return;
    await options.database.$transaction(async (transaction) => {
      const row = await transaction.mcpOAuthRefreshToken.findUnique({ where: { tokenHash: sha256(token) } });
      if (!row || row.clientId !== clientId || row.revokedAt) return;
      const now = options.now();
      await transaction.mcpOAuthRefreshToken.update({ where: { id: row.id }, data: { revokedAt: now, lastUsedAt: now } });
      await appendAuditLog(transaction, {
        workspaceId: row.workspaceId,
        actorId: row.authorizingActorId,
        action: "mcp.oauth.refresh_token.revoked",
        entityType: "McpOAuthRefreshToken",
        entityId: row.id,
        metadata: { clientId },
      });
    });
  }

  async function verifyAccessToken(token: string): Promise<AuthInfo> {
    const claims = verifySignedAccessToken(options.signingSecret(), token, options.now());
    const active = await options.database.workspaceMember.findFirst({
      where: {
        id: claims.member_id,
        workspaceId: claims.workspace_id,
        userId: claims.sub,
        status: "ACTIVE",
        deletedAt: null,
        user: { status: "ACTIVE", deletedAt: null },
        workspace: { status: "ACTIVE", deletedAt: null },
      },
      select: { id: true },
    });
    if (!active) invalidToken();
    return {
      token,
      clientId: claims.client_id,
      scopes: claims.scope.split(" "),
      expiresAt: claims.exp,
      resource: new URL(claims.aud),
      extra: {
        workspaceId: claims.workspace_id,
        userId: claims.sub,
        memberId: claims.member_id,
        authorizingActorId: claims.actor_id,
      } satisfies McpAuthExtra,
    };
  }

  return Object.freeze({
    parseAuthorizationRequest,
    createAuthorizationCode,
    exchangeAuthorizationCode,
    refreshAccessToken,
    revokeRefreshToken,
    verifyAccessToken,
  });
}

let singleton: ReturnType<typeof createPolitizaiMcpOAuthService> | undefined;
export function getPolitizaiMcpOAuthService() {
  singleton ??= createPolitizaiMcpOAuthService({
    database: getDatabaseClient(),
    now: () => new Date(),
    generateOpaqueToken: () => randomBytes(32).toString("base64url"),
    signingSecret: () => getPolitizaiMcpSigningSecret(),
  });
  return singleton;
}
