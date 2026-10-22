import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const crmMcpScopes = ["crm:read", "metrics:read", "audit:read", "operations:read", "integrations:read"] as const;
export const crmMcpClientSchema = z.object({
  clientId: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,79}$/),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceId: z.string().uuid(),
  memberId: z.string().uuid(),
  scopes: z.array(z.enum(crmMcpScopes)).min(1).max(5),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type CrmMcpClient = z.infer<typeof crmMcpClientSchema>;
export type CrmMcpIdentity = Readonly<{ clientId: string; scopes: CrmMcpClient["scopes"]; context: AuthenticatedContext }>;

function unavailable(): never {
  throw new ApplicationError("MCP do CRM não configurado.", { code: "CRM_MCP_UNAVAILABLE", statusCode: 503, expose: true });
}
function unauthorized(): never {
  throw new ApplicationError("Credencial MCP inválida, expirada ou revogada.", { code: "CRM_MCP_UNAUTHORIZED", statusCode: 401, expose: true });
}

export function parseCrmMcpClients(raw: string | undefined): CrmMcpClient[] {
  if (!raw) unavailable();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { unavailable(); }
  const parsed = z.array(crmMcpClientSchema).min(1).max(100).safeParse(value);
  if (!parsed.success) unavailable();
  if (new Set(parsed.data.map((client) => client.clientId)).size !== parsed.data.length
    || new Set(parsed.data.map((client) => client.tokenHash)).size !== parsed.data.length) unavailable();
  return parsed.data;
}

export async function authenticateCrmMcp(
  request: Request,
  database: Pick<PrismaClient, "workspaceMember" | "actor">,
  rawClients = process.env.CRM_MCP_CLIENTS_JSON,
  now = new Date(),
): Promise<CrmMcpIdentity> {
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer [A-Za-z0-9_-]{43,200}$/.test(header)) unauthorized();
  const digest = createHash("sha256").update(header.slice(7)).digest();
  const client = parseCrmMcpClients(rawClients).find((candidate) => timingSafeEqual(digest, Buffer.from(candidate.tokenHash, "hex")));
  if (!client || new Date(client.expiresAt) <= now) unauthorized();
  // Rebuild the context for every request so disabled users, roles and members
  // immediately lose access. The bot never supplies its workspace or actor.
  const member = await database.workspaceMember.findFirst({
    where: {
      id: client.memberId, workspaceId: client.workspaceId, status: "ACTIVE", deletedAt: null,
      user: { status: "ACTIVE", deletedAt: null }, role: { deletedAt: null },
      workspace: { status: "ACTIVE", deletedAt: null },
    },
    select: { id: true, userId: true, roleId: true, role: { select: { key: true, name: true } }, workspace: { select: { slug: true } }, user: { select: { displayName: true } } },
  });
  if (!member) unauthorized();
  const actor = await database.actor.findFirst({ where: { workspaceId: client.workspaceId, userId: member.userId, type: "HUMAN" }, select: { id: true } });
  if (!actor) unauthorized();
  return {
    clientId: client.clientId, scopes: client.scopes,
    context: Object.freeze({
      workspaceId: client.workspaceId, workspaceSlug: member.workspace.slug,
      sessionId: `mcp:${client.clientId}`, memberId: member.id, userId: member.userId,
      actorId: actor.id, roleId: member.roleId, roleKey: member.role.key,
      roleName: member.role.name, displayName: member.user.displayName,
    }),
  };
}
