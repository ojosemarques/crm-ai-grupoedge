import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Prisma, PrismaClient, McpOAuthRefreshToken } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { crmMcpScopes, resolveCrmMcpIdentity, type CrmMcpIdentity } from "./crm-mcp-authentication";
import { getCrmMcpOAuthConfig, getCrmMcpOAuthSecret, type CrmMcpOAuthConfig } from "@/modules/crm-mcp/domain/crm-mcp-oauth-config";
import { getDatabaseClient } from "@/shared/core/database/client";

const ACCESS_SECONDS = 600;
const CODE_SECONDS = 300;
const REFRESH_SECONDS = 30 * 86400;
const CLIENT_PREFIX = "crm_dcr_";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fingerprint = (value: string) => `oauth-${hash(value).slice(0, 24)}`;
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43,200}$/);
const verifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);

function fail(code: OAuthErrorCode, message: string): never { throw new OAuthError(code, message); }
function invalidGrant(): never { fail(OAuthErrorCode.InvalidGrant, "Concessão OAuth inválida ou expirada."); }
function invalidToken(): never { fail(OAuthErrorCode.InvalidToken, "Token OAuth inválido, expirado ou revogado."); }
function scopes(raw: string | undefined, allowed: readonly string[] = crmMcpScopes) {
  const requested = raw === undefined ? [...allowed] : [...new Set(raw.trim().split(/\s+/))];
  if (!requested.length || requested.some((scope) => !allowed.includes(scope) || !crmMcpScopes.includes(scope as typeof crmMcpScopes[number]))) fail(OAuthErrorCode.InvalidScope, "Escopo OAuth não concedido.");
  return requested as CrmMcpIdentity["scopes"];
}

function safeRedirect(value: string) {
  try {
    const url = new URL(value);
    return !url.hash && !url.username && !url.password
      && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}
const registrationSchema = z.object({
  redirect_uris: z.array(z.string().max(350).refine(safeRedirect)).min(1).max(3),
  client_name: z.string().trim().min(1).max(80).default("Cliente MCP"),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).min(1).max(2).default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).length(1).default(["code"]),
  scope: z.string().max(200).optional(),
});
const authorizationSchema = z.object({
  response_type: z.literal("code"), client_id: z.string().max(1800), redirect_uri: z.string().max(350),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal("S256"),
  resource: z.string().url(), state: z.string().min(1).max(1024).optional(), scope: z.string().max(200).optional(),
}).strict();
type RegisteredClient = z.output<typeof registrationSchema> & { scope: string };
type Authorization = z.output<typeof authorizationSchema> & { scopes: CrmMcpIdentity["scopes"]; clientName: string; refreshAllowed: boolean };
type Options = { database: PrismaClient; now: () => Date; signingSecret: () => string; config: () => CrmMcpOAuthConfig; generateOpaqueToken?: () => string };
const accessSchema = z.object({ sub: z.string().uuid(), workspace_id: z.string().uuid(), member_id: z.string().uuid(), actor_id: z.string().uuid(), client_id: z.string().max(1800), grant_id: z.string().uuid(), scope: z.string().min(1).max(200) });

export function createCrmMcpOAuthService(options: Options) {
  const generate = options.generateOpaqueToken ?? (() => randomBytes(32).toString("base64url"));
  const seconds = () => Math.floor(options.now().getTime() / 1000);
  const key = () => new TextEncoder().encode(options.signingSecret());
  async function sign(payload: JWTPayload, kind: string, audience: string, lifetime: number) {
    return new SignJWT(payload).setProtectedHeader({ alg: "HS256", typ: kind }).setIssuer(options.config().issuer)
      .setAudience(audience).setIssuedAt(seconds()).setExpirationTime(seconds() + lifetime).setJti(generate()).sign(key());
  }
  async function verify(token: string, kind: string, audience: string) {
    return (await jwtVerify(token, key(), { algorithms: ["HS256"], typ: kind, issuer: options.config().issuer, audience, currentDate: options.now(), clockTolerance: 0 })).payload;
  }
  async function register(input: unknown) {
    const parsed = registrationSchema.safeParse(input);
    if (!parsed.success || !parsed.data.grant_types.includes("authorization_code")) fail(OAuthErrorCode.InvalidClientMetadata, "Metadados de cliente inválidos. Use authorization_code, PKCE e autenticação none.");
    const client: RegisteredClient = { ...parsed.data, scope: scopes(parsed.data.scope).join(" ") };
    const clientId = CLIENT_PREFIX + await sign(client, "crm-client+jwt", `${options.config().issuer}/clients`, 90 * 86400);
    if (clientId.length > 1800) fail(OAuthErrorCode.InvalidClientMetadata, "Metadados de cliente excedem o limite.");
    // The signed client ID contains public metadata only. No client secret or
    // per-registration database row is needed for a public PKCE client.
    return { ...client, client_id: clientId, client_id_issued_at: seconds() };
  }
  async function registered(clientId: string): Promise<RegisteredClient> {
    try {
      if (!clientId.startsWith(CLIENT_PREFIX) || clientId.length > 1800) throw new Error("invalid");
      const payload = await verify(clientId.slice(CLIENT_PREFIX.length), "crm-client+jwt", `${options.config().issuer}/clients`);
      const parsed = registrationSchema.parse(payload);
      return { ...parsed, scope: scopes(parsed.scope).join(" ") };
    } catch { fail(OAuthErrorCode.InvalidClient, "Cliente OAuth inválido ou expirado."); }
  }
  async function parseAuthorizationRequest(raw: unknown) : Promise<Authorization> {
    const input = authorizationSchema.parse(raw);
    const client = await registered(input.client_id);
    if (!client.redirect_uris.includes(input.redirect_uri)) fail(OAuthErrorCode.InvalidRequest, "URI de retorno não registrada.");
    if (input.resource !== options.config().resource) fail(OAuthErrorCode.InvalidTarget, "Recurso OAuth inválido.");
    return { ...input, scopes: scopes(input.scope, client.scope.split(" ")), clientName: client.client_name, refreshAllowed: client.grant_types.includes("refresh_token") };
  }
  async function createConsent(context: AuthenticatedContext, request: Authorization) {
    return sign({ session_hash: hash(context.sessionId), request_hash: hash(JSON.stringify(request)) }, "crm-consent+jwt", `${options.config().issuer}/consent`, CODE_SECONDS);
  }
  async function validateConsent(token: string, context: AuthenticatedContext, request: Authorization) {
    try {
      const payload = await verify(token, "crm-consent+jwt", `${options.config().issuer}/consent`);
      if (payload.session_hash !== hash(context.sessionId) || payload.request_hash !== hash(JSON.stringify(request))) throw new Error("invalid");
    } catch { fail(OAuthErrorCode.InvalidRequest, "Consentimento inválido ou expirado. Reabra a conexão."); }
  }
  async function audit(database: Prisma.TransactionClient, context: { workspaceId: string; actorId: string }, action: string, id: string, clientId: string) {
    await database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, origin: "API", action, entityType: "McpOAuthGrant", entityId: id, metadata: { clientFingerprint: fingerprint(clientId) } } });
  }
  async function createAuthorizationCode(context: AuthenticatedContext, request: Authorization) {
    const code = generate();
    await options.database.$transaction(async (tx) => {
      const row = await tx.mcpOAuthAuthorizationCode.create({ data: {
        workspaceId: context.workspaceId, userId: context.userId, workspaceMemberId: context.memberId, authorizingActorId: context.actorId,
        clientId: request.client_id, redirectUri: request.redirect_uri, resource: request.resource, scope: request.scopes.join(" "),
        codeHash: hash(code), codeChallenge: request.code_challenge, expiresAt: new Date(options.now().getTime() + CODE_SECONDS * 1000),
      } });
      await audit(tx, context, "crm.mcp.oauth.authorized", row.id, request.client_id);
    });
    return code;
  }
  async function identity(row: Pick<McpOAuthRefreshToken, "workspaceId" | "workspaceMemberId" | "userId" | "authorizingActorId" | "clientId" | "scope">, database = options.database) {
    return resolveCrmMcpIdentity(database, { workspaceId: row.workspaceId, memberId: row.workspaceMemberId, userId: row.userId, actorId: row.authorizingActorId, clientId: fingerprint(row.clientId), scopes: scopes(row.scope) });
  }
  async function issue(tx: Prisma.TransactionClient, row: Pick<McpOAuthRefreshToken, "workspaceId" | "workspaceMemberId" | "userId" | "authorizingActorId" | "clientId" | "scope">, refreshAllowed: boolean) {
    const refreshToken = generate();
    const grant = await tx.mcpOAuthRefreshToken.create({ data: {
      ...row, resource: options.config().resource, tokenHash: hash(refreshToken), expiresAt: new Date(options.now().getTime() + (refreshAllowed ? REFRESH_SECONDS : ACCESS_SECONDS) * 1000),
    } });
    const accessToken = await sign({ sub: row.userId, workspace_id: row.workspaceId, member_id: row.workspaceMemberId, actor_id: row.authorizingActorId, client_id: row.clientId, grant_id: grant.id, scope: row.scope }, "crm-access+jwt", options.config().resource, ACCESS_SECONDS);
    await audit(tx, { workspaceId: row.workspaceId, actorId: row.authorizingActorId }, "crm.mcp.oauth.token.issued", grant.id, row.clientId);
    return { grantId: grant.id, response: { access_token: accessToken, token_type: "Bearer" as const, expires_in: ACCESS_SECONDS, scope: row.scope, ...(refreshAllowed ? { refresh_token: refreshToken } : {}) } };
  }
  async function revokeClientGrants(tx: Prisma.TransactionClient, row: McpOAuthRefreshToken, action: string) {
    await tx.mcpOAuthRefreshToken.updateMany({ where: { workspaceId: row.workspaceId, userId: row.userId, workspaceMemberId: row.workspaceMemberId, clientId: row.clientId, resource: row.resource, revokedAt: null }, data: { revokedAt: options.now() } });
    await audit(tx, { workspaceId: row.workspaceId, actorId: row.authorizingActorId }, action, row.id, row.clientId);
  }
  async function exchangeAuthorizationCode(input: { code: string; codeVerifier: string; clientId: string; redirectUri: string; resource: string }) {
    const client = await registered(input.clientId);
    if (!opaque.safeParse(input.code).success || !verifierSchema.safeParse(input.codeVerifier).success || input.resource !== options.config().resource || !client.redirect_uris.includes(input.redirectUri)) invalidGrant();
    return options.database.$transaction(async (tx) => {
      const row = await tx.mcpOAuthAuthorizationCode.findUnique({ where: { codeHash: hash(input.code) } });
      const challenge = createHash("sha256").update(input.codeVerifier).digest("base64url");
      if (!row || row.consumedAt || row.expiresAt <= options.now() || row.clientId !== input.clientId || row.resource !== input.resource || row.redirectUri !== input.redirectUri || row.codeChallenge.length !== challenge.length || !timingSafeEqual(Buffer.from(row.codeChallenge), Buffer.from(challenge))) invalidGrant();
      await identity(row);
      const consumed = await tx.mcpOAuthAuthorizationCode.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: options.now() } }, data: { consumedAt: options.now() } });
      if (consumed.count !== 1) invalidGrant();
      return (await issue(tx, { workspaceId: row.workspaceId, userId: row.userId, workspaceMemberId: row.workspaceMemberId, authorizingActorId: row.authorizingActorId, clientId: row.clientId, scope: row.scope }, client.grant_types.includes("refresh_token"))).response;
    }, { maxWait: 5000, timeout: 10000 });
  }
  async function refreshAccessToken(input: { refreshToken: string; clientId: string; resource: string; scope?: string }) {
    const client = await registered(input.clientId);
    if (!client.grant_types.includes("refresh_token") || !opaque.safeParse(input.refreshToken).success || input.resource !== options.config().resource) invalidGrant();
    const result = await options.database.$transaction(async (tx) => {
      const row = await tx.mcpOAuthRefreshToken.findUnique({ where: { tokenHash: hash(input.refreshToken) } });
      if (!row || row.resource !== input.resource || row.clientId !== input.clientId) invalidGrant();
      if (row.revokedAt) {
        if (row.rotatedToId) {
          // A rotated token replay can mean that the current token was stolen.
          // Commit revocation before returning invalid_grant outside the transaction.
          await revokeClientGrants(tx, row, "crm.mcp.oauth.refresh_replay.revoked");
        }
        return null;
      }
      if (row.expiresAt <= options.now()) invalidGrant();
      await identity(row);
      const requested = scopes(input.scope, row.scope.split(" "));
      const rotated = await tx.mcpOAuthRefreshToken.updateMany({ where: { id: row.id, revokedAt: null, expiresAt: { gt: options.now() } }, data: { revokedAt: options.now(), lastUsedAt: options.now() } });
      if (rotated.count !== 1) {
        const current = await tx.mcpOAuthRefreshToken.findUnique({ where: { id: row.id } });
        if (current?.rotatedToId) await revokeClientGrants(tx, current, "crm.mcp.oauth.refresh_replay.revoked");
        return null;
      }
      const next = await issue(tx, { workspaceId: row.workspaceId, userId: row.userId, workspaceMemberId: row.workspaceMemberId, authorizingActorId: row.authorizingActorId, clientId: row.clientId, scope: requested.join(" ") }, true);
      await tx.mcpOAuthRefreshToken.update({ where: { id: row.id }, data: { rotatedToId: next.grantId } });
      return next.response;
    }, { maxWait: 5000, timeout: 10000 });
    if (!result) invalidGrant();
    return result;
  }
  async function claims(token: string) {
    try {
      const payload = await verify(token, "crm-access+jwt", options.config().resource);
      if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.iat > seconds() || payload.exp - payload.iat > ACCESS_SECONDS) invalidToken();
      return accessSchema.parse(payload);
    } catch { invalidToken(); }
  }
  async function verifyAccessToken(token: string): Promise<CrmMcpIdentity> {
    const value = await claims(token);
    const row = await options.database.mcpOAuthRefreshToken.findUnique({ where: { id: value.grant_id } });
    if (!row || row.revokedAt || row.expiresAt <= options.now() || row.resource !== options.config().resource || row.workspaceId !== value.workspace_id || row.workspaceMemberId !== value.member_id || row.userId !== value.sub || row.authorizingActorId !== value.actor_id || row.clientId !== value.client_id) invalidToken();
    const granted = scopes(value.scope, row.scope.split(" "));
    return { ...await identity(row), scopes: granted };
  }
  async function revoke(token: string, clientId: string) {
    await registered(clientId);
    let row: McpOAuthRefreshToken | null;
    if (token.includes(".")) {
      let value: z.output<typeof accessSchema>;
      try { value = await claims(token); } catch { return; }
      row = await options.database.mcpOAuthRefreshToken.findUnique({ where: { id: value.grant_id } });
    } else {
      if (!opaque.safeParse(token).success) return;
      row = await options.database.mcpOAuthRefreshToken.findUnique({ where: { tokenHash: hash(token) } });
    }
    if (!row || row.clientId !== clientId || row.resource !== options.config().resource) return;
    await options.database.$transaction(async (tx) => {
      await revokeClientGrants(tx, row, "crm.mcp.oauth.revoked");
    });
  }
  return { register, parseAuthorizationRequest, createConsent, validateConsent, createAuthorizationCode, exchangeAuthorizationCode, refreshAccessToken, verifyAccessToken, revoke };
}

let singleton: ReturnType<typeof createCrmMcpOAuthService> | undefined;
export function getCrmMcpOAuthService() {
  singleton ??= createCrmMcpOAuthService({ database: getDatabaseClient(), now: () => new Date(), signingSecret: getCrmMcpOAuthSecret, config: getCrmMcpOAuthConfig });
  return singleton;
}
