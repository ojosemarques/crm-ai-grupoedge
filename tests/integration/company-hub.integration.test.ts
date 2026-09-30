import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { createAuthenticationService } from "@/modules/auth/application/authentication-service";
import { hashPassword } from "@/modules/auth/domain/password";
import { createCompanyHubService } from "@/modules/users/application/company-hub-service";
import { defaultRoleDefinitions } from "@/modules/users/permissions/default-role-definitions";
import { permissionCatalog } from "@/modules/users/permissions/permission-keys";
import { requireApiAuthentication } from "@/modules/auth/http/authentication-guards";
import { SESSION_COOKIE_NAME } from "@/modules/auth/http/session-cookie";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as switchRoute } from "@/app/api/auth/workspace/route";
import { GET as hubRoute, POST as hubCommandRoute } from "@/app/api/hub/route";
import { GET as financeRoute } from "@/app/api/finance/route";
import { GET as leadsRoute } from "@/app/api/leads/route";
import { GET as adsRoute } from "@/app/api/marketing/performance/route";

const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 5 }) });
const auth = createAuthenticationService({ database, sessionTtlHours: 8, maxFailedAttempts: 5, lockMinutes: 15 });
const hub = createCompanyHubService(database);
const password = "Hub-Secure-Password-123!";
const request = { ipAddress: "127.0.0.1", userAgent: "company-hub-integration" };
const suffix = randomUUID().slice(0, 8);
const adminEmail = `admin-${suffix}@hub.test`;
const sellerEmail = `seller-${suffix}@hub.test`;
let sourceId: string;
let admin: Awaited<ReturnType<typeof auth.login>>;
let seller: Awaited<ReturnType<typeof auth.login>>;
let createdId: string;
let outsideId: string;

function api(path: string, token?: string, body?: unknown, expectedSession?: string) {
  return new NextRequest(`http://localhost:3000${path}`, { method: body ? "POST" : "GET", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", ...(token ? { Cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}), ...(expectedSession ? { "x-crm-session": expectedSession } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const createInput = () => ({ action: "CREATE_COMPANY", name: `Authentico ${suffix}`, slug: `authentico-${suffix}`, confirmed: true, idempotencyKey: randomUUID() });

beforeAll(async () => {
  const workspace = await database.workspace.create({ data: { name: `Origem ${suffix}`, slug: `hub-origin-${suffix}` } }); sourceId = workspace.id;
  outsideId = (await database.workspace.create({ data: { name: "Empresa sem acesso", slug: `hub-outside-${suffix}` } })).id;
  const actor = await database.actor.create({ data: { workspaceId: sourceId, type: "SYSTEM", key: "system", displayName: "Sistema" } });
  await database.permission.createMany({ data: [...permissionCatalog], skipDuplicates: true });
  const permissions = new Map((await database.permission.findMany()).map(p => [p.key, p.id]));
  for (const [email, roleKey] of [[adminEmail, "administrator"], [sellerEmail, "sdr"]] as const) {
    const definition = defaultRoleDefinitions.find(r => r.key === roleKey)!;
    const role = await database.role.create({ data: { workspaceId: sourceId, key: roleKey, name: definition.name, createdByActorId: actor.id, updatedByActorId: actor.id } });
    await database.rolePermission.createMany({ data: definition.grants.map(([key, scope]) => ({ workspaceId: sourceId, roleId: role.id, permissionId: permissions.get(key)!, scope, createdByActorId: actor.id })), skipDuplicates: true });
    const user = await database.user.create({ data: { email, normalizedEmail: email, displayName: roleKey } });
    await database.localCredential.create({ data: { userId: user.id, passwordHash: await hashPassword(password) } });
    await database.workspaceMember.create({ data: { workspaceId: sourceId, userId: user.id, roleId: role.id, status: "ACTIVE", createdByActorId: actor.id, updatedByActorId: actor.id } });
    await database.actor.create({ data: { workspaceId: sourceId, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: roleKey } });
  }
  admin = await auth.login({ email: adminEmail, password, request });
  seller = await auth.login({ email: sellerEmail, password, request });
}, 30000);
afterAll(async () => { await database.$disconnect(); });

describe("Hub de empresas", () => {
  it("autentica sem workspace, entrega hub e não revela contas em falhas", async () => {
    const response = await loginRoute(api("/api/auth/login", undefined, { email: adminEmail, password }));
    expect(response.status).toBe(200); expect((await response.json()).redirectTo).toBe("/hub");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    await expect(auth.login({ email: adminEmail, password: "wrong", request })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(auth.login({ email: "absent@hub.test", password, request })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((await hubRoute(api("/api/hub"))).status).toBe(401);
  });
  it("mostra somente vínculos ativos e não permite criar empresa como vendedor", async () => {
    const screen = await hub.screen(seller.context);
    expect(screen.companies.map(c => c.id)).toEqual([sourceId]); expect(screen.canCreate).toBe(false);
    expect(screen.companies[0]!.members).toEqual([]);
    await expect(hub.execute(seller.context, createInput())).rejects.toMatchObject({ code: "COMPANY_ADMIN_REQUIRED" });
    await expect(auth.switchWorkspace(seller.token, outsideId, request)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    expect((await auth.validateSession(seller.token)).workspaceId).toBe(sourceId);
  });
  it("cria empresa completa e vazia, em uma transação, com replay seguro", async () => {
    const input = createInput();
    await expect(hub.execute(admin.context, { ...input, confirmed: false })).rejects.toBeDefined();
    const result = await hub.execute(admin.context, input); createdId = result.workspaceId;
    const response = await hubCommandRoute(api("/api/hub", admin.token, input)); expect(response.status).toBe(200);
    const replays = await Promise.all([hub.execute(admin.context, input), hub.execute(admin.context, input)]);
    expect(replays).toEqual([{ workspaceId: createdId, created: false }, { workspaceId: createdId, created: false }]);
    expect(await database.pipeline.count({ where: { workspaceId: createdId } })).toBe(2);
    expect(await database.role.count({ where: { workspaceId: createdId } })).toBe(5);
    expect(await database.financialCategory.count({ where: { workspaceId: createdId } })).toBe(3);
    expect(await database.financialAccount.count({ where: { workspaceId: createdId } })).toBe(1);
    expect(await database.lead.count({ where: { workspaceId: createdId } })).toBe(0);
    expect(await database.financialEntry.count({ where: { workspaceId: createdId } })).toBe(0);
    expect((await hub.screen(admin.context)).companies.map(c => c.id).sort()).toEqual([sourceId, createdId].sort());
    await expect(hub.execute(admin.context, { ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "COMPANY_CONFLICT" });
  }, 30000);
  it("compartilha o usuário sem duplicar identidade ou alterar senha; exige administração dos dois lados", async () => {
    const role = await database.role.findFirstOrThrow({ where: { workspaceId: createdId, key: "sdr" } });
    const credential = await database.localCredential.findUniqueOrThrow({ where: { userId: seller.context.userId } });
    const command = { action: "GRANT_ACCESS", sourceWorkspaceId: sourceId, targetWorkspaceId: createdId, memberId: seller.context.memberId, roleId: role.id, confirmed: true };
    await expect(hub.execute(seller.context, command)).rejects.toMatchObject({ code: "COMPANY_ADMIN_REQUIRED" });
    await expect(hub.execute(admin.context, { ...command, targetWorkspaceId: outsideId })).rejects.toMatchObject({ code: "COMPANY_ADMIN_REQUIRED" });
    await expect(hub.execute(admin.context, { ...command, roleId: admin.context.roleId })).rejects.toMatchObject({ code: "COMPANY_ADMIN_REQUIRED" });
    expect((await hub.execute(admin.context, command)).created).toBe(true);
    expect((await hub.execute(admin.context, command)).created).toBe(false);
    expect((await database.localCredential.findUniqueOrThrow({ where: { userId: seller.context.userId } })).passwordHash).toBe(credential.passwordHash);
    expect(await database.user.count({ where: { normalizedEmail: sellerEmail } })).toBe(1);
    expect((await hub.screen(seller.context)).companies).toHaveLength(2);
  });
  it("troca com novo token, revoga o antigo, mantém vencimento e barra abas com sessão anterior", async () => {
    const fresh = await auth.login({ email: adminEmail, password, request });
    const response = await switchRoute(api("/api/auth/workspace", fresh.token, { workspaceId: createdId }, fresh.context.sessionId));
    expect(response.status).toBe(200);
    const token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    const context = await auth.validateSession(token);
    expect(context.workspaceId).toBe(createdId); expect(context.actorId).not.toBe(fresh.context.actorId);
    await expect(auth.validateSession(fresh.token)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    const session = await database.authSession.findUniqueOrThrow({ where: { id: context.sessionId } });
    expect(session.expiresAt).toEqual(fresh.expiresAt);
    await expect(requireApiAuthentication(api("/api/hub", token, undefined, fresh.context.sessionId))).rejects.toMatchObject({ code: "COMPANY_SESSION_CHANGED" });
    const financial = await financeRoute(api("/api/finance", token)); expect(financial.status).toBe(200);
    const body = await financial.json(); expect(JSON.stringify(body)).not.toContain(sourceId);
    expect((await leadsRoute(api("/api/leads", token))).status).toBe(200);
    expect((await adsRoute(api("/api/marketing/performance", token))).status).toBe(200);
    expect(await database.auditLog.count({ where: { workspaceId: createdId, action: "auth.workspace.selected" } })).toBeGreaterThan(0);
  });
  it("aplica o papel da empresa selecionada e respeita revogação de acesso", async () => {
    const selected = await auth.switchWorkspace(seller.token, createdId, request);
    expect(selected.context.roleKey).toBe("sdr");
    expect((await financeRoute(api("/api/finance", selected.token))).status).toBe(403);
    await database.workspaceMember.update({ where: { id: selected.context.memberId }, data: { status: "INACTIVE" } });
    await expect(auth.validateSession(selected.token)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    const relogin = await auth.login({ email: sellerEmail, password, request });
    expect(relogin.context.workspaceId).toBe(sourceId);
    expect((await hub.screen(relogin.context)).companies.map(c => c.id)).toEqual([sourceId]);
    await expect(auth.switchWorkspace(relogin.token, createdId, request)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  });
  it("recusa origem externa e comandos malformados", async () => {
    const evil = api("/api/auth/workspace", admin.token, { workspaceId: createdId }); evil.headers.set("origin", "https://evil.test");
    expect((await switchRoute(evil)).status).toBe(403);
    expect((await switchRoute(api("/api/auth/workspace", admin.token, { workspaceId: "invalid" }))).status).toBe(400);
  });
  it("falha de gravação na inicialização não deixa empresa parcial", async () => {
    const broken = database.$extends({ query: { financialAccount: { create() { throw new Error("forced foundation failure"); } } } });
    const input = { ...createInput(), slug: `hub-rollback-${suffix}` };
    await expect(createCompanyHubService(broken as unknown as PrismaClient).execute(admin.context, input)).rejects.toThrow("forced foundation failure");
    expect(await database.workspace.count({ where: { slug: input.slug } })).toBe(0);
  });
});
