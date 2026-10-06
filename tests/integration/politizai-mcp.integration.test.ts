import { createHash } from "node:crypto";

import { OAuthErrorCode } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createPolitizaiMcpOAuthService } from "@/modules/prospecting/application/politizai-mcp-oauth-service";
import { createPolitizaiMcpProspectingService } from "@/modules/prospecting/application/politizai-mcp-prospecting-service";
import { POLITIZAI_MCP_CALLBACK_CLIENT_ID, POLITIZAI_MCP_CALLBACK_REDIRECT_URI, getPolitizaiMcpPublicConfig } from "@/modules/prospecting/domain/politizai-mcp-config";
import { ensureProductionFoundationInTransaction } from "@/modules/settings/application/production-foundation-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for Politizai MCP integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 5 }) });
const clock = new Date("2026-10-06T15:00:00.000Z");
const secret = "politizai-mcp-integration-signing-secret-with-more-than-32-chars";
let counter = 0;
const oauth = createPolitizaiMcpOAuthService({ database, now: () => clock, generateOpaqueToken: () => `opaque-token-${String(++counter).padStart(40, "0")}`, signingSecret: () => secret });
const prospecting = createPolitizaiMcpProspectingService({ database, now: () => clock });
let context: AuthenticatedContext;

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  await database.$transaction((transaction) => ensureProductionFoundationInTransaction(transaction, "politizai"));
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, status: "ACTIVE", deletedAt: null }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, userId: member.userId, type: "HUMAN" } });
  context = {
    workspaceId: seeded.workspaceId,
    workspaceSlug: "politizai",
    sessionId: crypto.randomUUID(),
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  };
});

afterAll(async () => { await database.$disconnect(); });

describe("MCP privado Politizai", () => {
  it("aplica PKCE, uso único, audience e rotação do refresh token", async () => {
    const verifier = "v".repeat(64);
    const resource = getPolitizaiMcpPublicConfig().resource.href;
    const request = oauth.parseAuthorizationRequest({
      response_type: "code",
      client_id: POLITIZAI_MCP_CALLBACK_CLIENT_ID,
      redirect_uri: POLITIZAI_MCP_CALLBACK_REDIRECT_URI,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "integration-state",
      resource,
      scope: "prospecting:read prospecting:research prospecting:review",
    });
    const code = await oauth.createAuthorizationCode(context, request);
    const first = await oauth.exchangeAuthorizationCode({ code, codeVerifier: verifier, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, redirectUri: POLITIZAI_MCP_CALLBACK_REDIRECT_URI, resource });
    await expect(oauth.exchangeAuthorizationCode({ code, codeVerifier: verifier, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, redirectUri: POLITIZAI_MCP_CALLBACK_REDIRECT_URI, resource })).rejects.toMatchObject({ code: OAuthErrorCode.InvalidGrant });
    await expect(oauth.verifyAccessToken(first.access_token)).resolves.toMatchObject({ clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, scopes: ["prospecting:read", "prospecting:research", "prospecting:review"] });
    const rotated = await oauth.refreshAccessToken({ refreshToken: first.refresh_token, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, resource });
    await expect(oauth.refreshAccessToken({ refreshToken: first.refresh_token, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, resource })).rejects.toMatchObject({ code: OAuthErrorCode.InvalidGrant });
    await expect(oauth.verifyAccessToken(rotated.access_token)).resolves.toMatchObject({ resource: new URL(resource) });
    await expect(oauth.refreshAccessToken({ refreshToken: rotated.refresh_token, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, resource: "https://outro.example/mcp" })).rejects.toMatchObject({ code: OAuthErrorCode.InvalidGrant });
  });

  it("concede um alvo por vez e registra apenas no estoque, sem Lead nem e-mail", async () => {
    const opened = await prospecting.openBatch({ workspaceId: context.workspaceId, userId: context.userId, memberId: context.memberId, authorizingActorId: context.actorId });
    const batchId = opened.batch.id;
    await database.prospectingResearchTarget.create({ data: { workspaceId: context.workspaceId, batchId, externalIdentityKey: "tse-2024:integration-mayor-1", tseCandidateId: "integration-mayor-1", role: "MAYOR", politicianName: "Prefeita Integração", ballotName: "Prefeita Integração", municipalityName: "Cidade Integração", municipalityIbgeCode: "3550308", stateCode: "SP", population: 1_000_000 } });
    const auth = { workspaceId: context.workspaceId, userId: context.userId, memberId: context.memberId, authorizingActorId: context.actorId };
    const claim = await prospecting.claimNextTarget(auth, batchId);
    expect(claim).toMatchObject({ queueEmpty: false, target: { politicianName: "Prefeita Integração" } });
    await expect(prospecting.claimNextTarget(auth, batchId)).resolves.toEqual({ target: null, queueEmpty: true });
    const target = claim.target!;
    const ingested = await prospecting.registerCandidate(auth, {
      targetId: target.id,
      leaseOwner: target.leaseOwner,
      politician: { mandateStatus: "CURRENT", mandateVerifiedAt: "2026-10-06T11:00:00-03:00" },
      contact: { phone: "+551140001234", phoneScope: "OFFICE", email: "gabinete@prefeitura.sp.gov.br", emailScope: "OFFICE", instagram: null, instagramScope: null },
      sources: [
        { field: "mandate", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/prefeita", observedAt: "2026-10-06T11:00:00-03:00", validationMethod: "OFFICIAL_SOURCE_CHECK" },
        { field: "phone", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/contato", observedAt: "2026-10-06T11:00:00-03:00", contactScope: "OFFICE", validationMethod: "OFFICIAL_SOURCE_CHECK" },
        { field: "email", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/contato", observedAt: "2026-10-06T11:00:00-03:00", contactScope: "OFFICE", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      ],
    });
    expect(ingested).toMatchObject({ duplicate: false, candidate: { status: "READY" } });
    await expect(database.lead.count({ where: { workspaceId: context.workspaceId } })).resolves.toBe(0);
    await expect(database.prospectingEmailJob.count({ where: { workspaceId: context.workspaceId } })).resolves.toBe(0);
    await expect(database.prospectingSettings.findUniqueOrThrow({ where: { workspaceId: context.workspaceId }, select: { emailEgressEnabled: true } })).resolves.toEqual({ emailEgressEnabled: false });
  });

  it("mantém RLS e privilégios fechados nas três tabelas novas", async () => {
    const rows = await database.$queryRaw<Array<{ tableName: string; rowSecurity: boolean; anonPrivileges: boolean; authenticatedPrivileges: boolean }>>`
      SELECT c.relname AS "tableName", c.relrowsecurity AS "rowSecurity",
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') ELSE FALSE END AS "anonPrivileges",
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') ELSE FALSE END AS "authenticatedPrivileges"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname IN ('prospecting_research_targets', 'mcp_oauth_authorization_codes', 'mcp_oauth_refresh_tokens')
      ORDER BY c.relname
    `;
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ rowSecurity: true, anonPrivileges: false, authenticatedPrivileges: false })]));
  });
});
