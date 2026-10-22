import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createCrmMcpOAuthService } from "@/modules/crm-mcp/application/crm-mcp-oauth-service";
import { getCrmMcpOAuthConfig } from "@/modules/crm-mcp/domain/crm-mcp-oauth-config";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL!;
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 5 }) });
const config = getCrmMcpOAuthConfig();
const service = createCrmMcpOAuthService({ database, now: () => new Date(), signingSecret: () => "crm-mcp-isolated-integration-signing-key-at-least-32-characters", config: () => config });
const verifier = "v".repeat(64);
const redirectUri = "https://client.example/callback";
let context: AuthenticatedContext;

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, status: "ACTIVE", role: { key: "administrator" } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  context = { workspaceId: member.workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName, sessionId: crypto.randomUUID() };
});
afterAll(async () => database.$disconnect());
async function authorization() {
  const client = await service.register({ redirect_uris: [redirectUri], client_name: "OpenBot integração", scope: "crm:read metrics:read" });
  const request = await service.parseAuthorizationRequest({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, resource: config.resource, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "integration-state" });
  const code = await service.createAuthorizationCode(context, request);
  return { client, input: { code, codeVerifier: verifier, clientId: client.client_id, redirectUri, resource: config.resource } };
}

describe("OAuth do CRM com persistência relacional isolada", () => {
  it("consome um authorization code exatamente uma vez sob concorrência", async () => {
    const { input } = await authorization();
    const results = await Promise.allSettled([service.exchangeAuthorizationCode(input), service.exchangeAuthorizationCode(input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const successful = results.find((result) => result.status === "fulfilled")!;
    if (successful.status !== "fulfilled") throw new Error("Expected one authorization exchange");
    await expect(service.verifyAccessToken(successful.value.access_token)).resolves.toMatchObject({ context: { workspaceId: context.workspaceId, memberId: context.memberId } });
  });
  it("revoga imediatamente o acesso e a renovação do grant", async () => {
    const { client, input } = await authorization(); const tokens = await service.exchangeAuthorizationCode(input);
    await service.revoke(tokens.refresh_token!, client.client_id);
    await expect(service.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(service.refreshAccessToken({ clientId: client.client_id, resource: config.resource, refreshToken: tokens.refresh_token! })).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("recusa chamadas e refresh quando o membro é suspenso", async () => {
    const { client, input } = await authorization(); const tokens = await service.exchangeAuthorizationCode(input);
    await database.workspaceMember.update({ where: { id: context.memberId }, data: { status: "INACTIVE" } });
    try {
      await expect(service.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({ statusCode: 401 });
      await expect(service.refreshAccessToken({ clientId: client.client_id, resource: config.resource, refreshToken: tokens.refresh_token! })).rejects.toMatchObject({ statusCode: 401 });
    } finally { await database.workspaceMember.update({ where: { id: context.memberId }, data: { status: "ACTIVE" } }); }
  });
  it("revoga a concessão atual ao detectar replay de refresh rotacionado", async () => {
    const { client, input } = await authorization(); const first = await service.exchangeAuthorizationCode(input);
    const refreshInput = { clientId: client.client_id, resource: config.resource, refreshToken: first.refresh_token! };
    const next = await service.refreshAccessToken(refreshInput);
    await expect(service.verifyAccessToken(next.access_token)).resolves.toBeDefined();
    await expect(service.refreshAccessToken(refreshInput)).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(service.verifyAccessToken(next.access_token)).rejects.toMatchObject({ code: "invalid_token" });
  });
  it("detecta disputa concorrente pelo mesmo refresh e revoga a concessão sucessora", async () => {
    const { client, input } = await authorization(); const first = await service.exchangeAuthorizationCode(input);
    const refreshInput = { clientId: client.client_id, resource: config.resource, refreshToken: first.refresh_token! };
    const results = await Promise.allSettled([service.refreshAccessToken(refreshInput), service.refreshAccessToken(refreshInput)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const next = results.find((result) => result.status === "fulfilled")!;
    if (next.status !== "fulfilled") throw new Error("Expected one refresh exchange");
    await expect(service.verifyAccessToken(next.value.access_token)).rejects.toMatchObject({ code: "invalid_token" });
  });
  it("reavalia o RBAC atual em cada contexto de chamada mesmo com token válido", async () => {
    const { input } = await authorization(); const tokens = await service.exchangeAuthorizationCode(input);
    const authorizationService = createAuthorizationService({ database });
    const first = await service.verifyAccessToken(tokens.access_token);
    const resource = { workspaceId: context.workspaceId, resourceType: "Metrics", ownerMemberId: context.memberId };
    await expect(authorizationService.authorize(first.context, PermissionKeys.METRICS_READ, resource)).resolves.toMatchObject({ allowed: true });
    await database.rolePermission.deleteMany({ where: { workspaceId: context.workspaceId, roleId: context.roleId, permission: { key: PermissionKeys.METRICS_READ } } });
    const next = await service.verifyAccessToken(tokens.access_token);
    await expect(authorizationService.authorize(next.context, PermissionKeys.METRICS_READ, resource)).resolves.toMatchObject({ allowed: false });
  });
});
