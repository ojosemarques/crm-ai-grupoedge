import { createHash, randomUUID } from "node:crypto";
import { decodeJwt, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import type { McpOAuthAuthorizationCode, McpOAuthRefreshToken, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createCrmMcpOAuthService } from "./crm-mcp-oauth-service";
import { crmMcpOAuthMetadata, crmMcpResourceMetadata, type CrmMcpOAuthConfig } from "../domain/crm-mcp-oauth-config";

const config: CrmMcpOAuthConfig = {
  issuer: "https://crm.example/api/oauth/crm", resource: "https://crm.example/api/mcp/crm",
  resourceMetadata: "https://crm.example/.well-known/oauth-protected-resource/api/mcp/crm",
  serverMetadata: "https://crm.example/.well-known/oauth-authorization-server/api/oauth/crm",
  authorizationEndpoint: "https://crm.example/api/oauth/crm/authorize", tokenEndpoint: "https://crm.example/api/oauth/crm/token",
  registrationEndpoint: "https://crm.example/api/oauth/crm/register", revocationEndpoint: "https://crm.example/api/oauth/crm/revoke",
};
const context: AuthenticatedContext = { workspaceId: "11111111-1111-4111-8111-111111111111", memberId: "22222222-2222-4222-8222-222222222222", userId: "33333333-3333-4333-8333-333333333333", actorId: "44444444-4444-4444-8444-444444444444", roleId: "55555555-5555-4555-8555-555555555555", roleKey: "administrator", roleName: "Administrador", displayName: "Test", workspaceSlug: "test", sessionId: "browser-session" };
const secret = "crm-oauth-test-signing-key-exclusive-and-at-least-32-characters";
const redirectUri = "https://client.example/callback";
const verifier = "v".repeat(64);

function fixture() {
  const state = { now: new Date("2026-10-22T12:00:00Z"), memberActive: true, userActive: true, roleActive: true, workspaceActive: true, actorActive: true };
  const codes = new Map<string, McpOAuthAuthorizationCode>();
  const grants = new Map<string, McpOAuthRefreshToken>();
  const audit = vi.fn().mockResolvedValue({});
  const db = {
    workspaceMember: { findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId: string; userId?: string } }) => state.memberActive && state.userActive && state.roleActive && state.workspaceActive && where.id === context.memberId && where.workspaceId === context.workspaceId && (!where.userId || where.userId === context.userId)
      ? { id: context.memberId, userId: context.userId, roleId: context.roleId, role: { key: context.roleKey, name: context.roleName }, workspace: { slug: context.workspaceSlug }, user: { displayName: context.displayName } } : null) },
    actor: { findFirst: vi.fn(async () => state.actorActive ? { id: context.actorId } : null) },
    auditLog: { create: audit },
    mcpOAuthAuthorizationCode: {
      create: vi.fn(async ({ data }: { data: Omit<McpOAuthAuthorizationCode, "id" | "consumedAt" | "createdAt"> }) => { const row = { ...data, id: randomUUID(), consumedAt: null, createdAt: state.now }; codes.set(row.id, row); return row; }),
      findUnique: vi.fn(async ({ where }: { where: { codeHash: string } }) => [...codes.values()].find((row) => row.codeHash === where.codeHash) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<McpOAuthAuthorizationCode> }) => { const row = codes.get(where.id); if (!row || row.consumedAt || row.expiresAt <= state.now) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    },
    mcpOAuthRefreshToken: {
      create: vi.fn(async ({ data }: { data: Omit<McpOAuthRefreshToken, "id" | "createdAt" | "revokedAt" | "lastUsedAt" | "rotatedToId"> }) => { const row = { ...data, id: randomUUID(), createdAt: state.now, revokedAt: null, lastUsedAt: null, rotatedToId: null }; grants.set(row.id, row); return row; }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; tokenHash?: string } }) => [...grants.values()].find((row) => where.id ? row.id === where.id : row.tokenHash === where.tokenHash) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: Partial<Pick<McpOAuthRefreshToken, "id" | "workspaceId" | "userId" | "workspaceMemberId" | "clientId" | "resource">>; data: Partial<McpOAuthRefreshToken> }) => {
        const selected = [...grants.values()].filter((row) => !row.revokedAt && row.expiresAt > state.now && Object.entries(where).every(([key, value]) => ["revokedAt", "expiresAt"].includes(key) || row[key as keyof typeof row] === value));
        selected.forEach((row) => Object.assign(row, data)); return { count: selected.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<McpOAuthRefreshToken> }) => { const row = grants.get(where.id)!; Object.assign(row, data); return row; }),
    },
    $transaction: async <T>(operation: (database: unknown) => Promise<T>): Promise<T> => operation(db),
  };
  const service = createCrmMcpOAuthService({ database: db as unknown as PrismaClient, now: () => state.now, signingSecret: () => secret, config: () => config });
  async function request(scope = "crm:read metrics:read") {
    const registration = await service.register({ redirect_uris: [redirectUri], client_name: "OpenBot", scope });
    const authorization = await service.parseAuthorizationRequest({ response_type: "code", client_id: registration.client_id, redirect_uri: redirectUri, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "client-state", resource: config.resource, scope });
    return { registration, authorization };
  }
  async function issue(scope?: string) {
    const setup = await request(scope);
    const code = await service.createAuthorizationCode(context, setup.authorization);
    const input = { code, codeVerifier: verifier, clientId: setup.registration.client_id, redirectUri, resource: config.resource };
    const tokens = await service.exchangeAuthorizationCode(input);
    return { ...setup, input, tokens };
  }
  return { state, codes, grants, audit, db, service, request, issue };
}

describe("CRM MCP OAuth discovery and dynamic registration", () => {
  it("advertises its resource, issuer, DCR and public PKCE flow", () => {
    expect(crmMcpResourceMetadata(config)).toMatchObject({ resource: config.resource, authorization_servers: [config.issuer] });
    expect(crmMcpOAuthMetadata(config)).toMatchObject({ issuer: config.issuer, registration_endpoint: config.registrationEndpoint, token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] });
    expect(JSON.stringify(crmMcpOAuthMetadata(config))).not.toContain("secret");
  });
  it("registers a public client without storing a client credential or a database row", async () => {
    const f = fixture(); const result = await f.service.register({ redirect_uris: [redirectUri], client_name: "OpenBot" });
    expect(result.token_endpoint_auth_method).toBe("none");
    expect(result).not.toHaveProperty("client_secret");
    expect(f.codes.size + f.grants.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it.each(["http://client.example/callback", "https://user:pass@client.example/callback", "https://client.example/callback#fragment", "javascript:alert(1)"])("rejects unsafe callback %s", async (uri) => {
    await expect(fixture().service.register({ redirect_uris: [uri] })).rejects.toMatchObject({ code: "invalid_client_metadata" });
  });
  it("allows an exact loopback callback for desktop clients", async () => {
    await expect(fixture().service.register({ redirect_uris: ["http://127.0.0.1:6543/callback"] })).resolves.toHaveProperty("client_id");
  });
  it("rejects altered registrations and a callback changed after registration", async () => {
    const f = fixture(); const { registration, authorization } = await f.request();
    const { scopes: _scopes, clientName: _name, refreshAllowed: _refresh, ...raw } = authorization;
    void _scopes; void _name; void _refresh;
    await expect(f.service.parseAuthorizationRequest({ ...raw, client_id: `${registration.client_id}x` })).rejects.toMatchObject({ code: "invalid_client" });
    await expect(f.service.parseAuthorizationRequest({ ...raw, redirect_uri: "https://attacker.example/callback" })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("rejects unknown scopes and escalation beyond the registration", async () => {
    const f = fixture(); await expect(f.service.register({ redirect_uris: [redirectUri], scope: "crm:write" })).rejects.toMatchObject({ code: "invalid_scope" });
    const { authorization } = await f.request("crm:read");
    const { scopes: _scopes, clientName: _name, refreshAllowed: _refresh, ...raw } = authorization;
    void _scopes; void _name; void _refresh;
    await expect(f.service.parseAuthorizationRequest({ ...raw, scope: "audit:read" })).rejects.toMatchObject({ code: "invalid_scope" });
  });
});

describe("CRM MCP authorization, token lifecycle and identity boundaries", () => {
  it("binds consent to the browser session and the exact authorization request", async () => {
    const f = fixture(); const { authorization } = await f.request();
    const consent = await f.service.createConsent(context, authorization);
    await expect(f.service.validateConsent(consent, context, authorization)).resolves.toBeUndefined();
    await expect(f.service.validateConsent(consent, { ...context, sessionId: "other-session" }, authorization)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(f.service.validateConsent(consent, context, { ...authorization, scopes: ["audit:read"] })).rejects.toMatchObject({ code: "invalid_request" });
    f.state.now = new Date(f.state.now.getTime() + 301000);
    await expect(f.service.validateConsent(consent, context, authorization)).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("issues 10-minute access tokens, stores only code/refresh hashes and never audits credentials", async () => {
    const f = fixture(); const { input, tokens } = await f.issue();
    expect(tokens.expires_in).toBe(600);
    const identity = await f.service.verifyAccessToken(tokens.access_token);
    expect(identity).toMatchObject({ scopes: ["crm:read", "metrics:read"], context: { workspaceId: context.workspaceId, memberId: context.memberId } });
    expect(identity.clientId).toMatch(/^oauth-[a-f0-9]{24}$/);
    expect(JSON.stringify([...f.codes.values()])).not.toContain(input.code);
    expect(JSON.stringify([...f.grants.values()])).not.toContain(tokens.refresh_token);
    const audited = JSON.stringify(f.audit.mock.calls);
    expect(audited).not.toContain(input.code);
    expect(audited).not.toContain(tokens.access_token);
    expect(audited).not.toContain(tokens.refresh_token);
  });
  it("rejects wrong PKCE verifiers, replayed codes and codes with another resource", async () => {
    const f = fixture(); const { authorization, registration } = await f.request();
    const code = await f.service.createAuthorizationCode(context, authorization);
    const input = { code, codeVerifier: verifier, clientId: registration.client_id, redirectUri, resource: config.resource };
    await expect(f.service.exchangeAuthorizationCode({ ...input, codeVerifier: "x".repeat(64) })).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(f.service.exchangeAuthorizationCode({ ...input, resource: "https://other.example/mcp" })).rejects.toMatchObject({ code: "invalid_grant" });
    await f.service.exchangeAuthorizationCode(input);
    await expect(f.service.exchangeAuthorizationCode(input)).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("expires codes after five minutes and rejects access tokens at their expiry", async () => {
    const f = fixture(); const { tokens } = await f.issue();
    f.state.now = new Date(f.state.now.getTime() + 600000);
    await expect(f.service.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({ code: "invalid_token" });
    const { authorization, registration } = await f.request(); const code = await f.service.createAuthorizationCode(context, authorization);
    f.state.now = new Date(f.state.now.getTime() + 301000);
    await expect(f.service.exchangeAuthorizationCode({ code, codeVerifier: verifier, clientId: registration.client_id, redirectUri, resource: config.resource })).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("rotates refresh tokens, immediately invalidates the old grant and prevents scope escalation", async () => {
    const f = fixture(); const { tokens, registration } = await f.issue("crm:read");
    const input = { refreshToken: tokens.refresh_token!, clientId: registration.client_id, resource: config.resource };
    await expect(f.service.refreshAccessToken({ ...input, scope: "audit:read" })).rejects.toMatchObject({ code: "invalid_scope" });
    const next = await f.service.refreshAccessToken(input);
    await expect(f.service.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(f.service.verifyAccessToken(next.access_token)).resolves.toMatchObject({ scopes: ["crm:read"] });
    await expect(f.service.refreshAccessToken(input)).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(f.service.verifyAccessToken(next.access_token)).rejects.toMatchObject({ code: "invalid_token" });
  });
  it("revokes access immediately when its refresh grant is revoked", async () => {
    const f = fixture(); const { tokens, registration } = await f.issue();
    await f.service.revoke(tokens.refresh_token!, registration.client_id);
    await expect(f.service.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(f.service.refreshAccessToken({ refreshToken: tokens.refresh_token!, clientId: registration.client_id, resource: config.resource })).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("can revoke the current connection using an older rotated refresh token", async () => {
    const f = fixture(); const { tokens, registration } = await f.issue();
    const next = await f.service.refreshAccessToken({ refreshToken: tokens.refresh_token!, clientId: registration.client_id, resource: config.resource });
    await f.service.revoke(tokens.refresh_token!, registration.client_id);
    await expect(f.service.verifyAccessToken(next.access_token)).rejects.toMatchObject({ code: "invalid_token" });
  });
  it.each(["memberActive", "userActive", "workspaceActive", "roleActive", "actorActive"] as const)("revalidates %s for every call and refresh", async (key) => {
    const f = fixture(); const { tokens, registration } = await f.issue(); f.state[key] = false;
    await expect(f.service.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({ statusCode: 401 });
    await expect(f.service.refreshAccessToken({ refreshToken: tokens.refresh_token!, clientId: registration.client_id, resource: config.resource })).rejects.toMatchObject({ statusCode: 401 });
  });
  it("rejects tampered tokens and signed tokens with a different audience, tenant or ungranted scope", async () => {
    const f = fixture(); const { tokens } = await f.issue("crm:read");
    await expect(f.service.verifyAccessToken(`${tokens.access_token}x`)).rejects.toMatchObject({ code: "invalid_token" });
    const original = decodeJwt(tokens.access_token);
    for (const mutation of [{ aud: "https://other.example/mcp" }, { workspace_id: randomUUID() }, { scope: "audit:read" }, { scope: "" }]) {
      const modified = await new SignJWT({ ...original, ...mutation }).setProtectedHeader({ alg: "HS256", typ: "crm-access+jwt" }).sign(new TextEncoder().encode(secret));
      await expect(f.service.verifyAccessToken(modified)).rejects.toBeDefined();
    }
  });
});
