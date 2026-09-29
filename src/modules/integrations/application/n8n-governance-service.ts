import { timingSafeEqual } from "node:crypto";
import { Prisma, type N8nMachineScope, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  createN8nMachineSchema,
  createN8nRecipeSchema,
  n8nCommandSchema,
  n8nEventQuerySchema,
  n8nEventTypes,
  n8nMachineRequestHeadersSchema,
  n8nRecipeCatalog,
  reviewN8nProposalSchema,
  rotateN8nMachineSchema,
  setN8nMachineScopesSchema,
  setN8nMachineStatusSchema,
  setN8nRecipeStatusSchema,
  type N8nCommand,
} from "@/modules/integrations/domain/n8n-contracts";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { assertCausationDepth, createEphemeralN8nToken, fingerprintN8nToken, hashN8nToken, safeN8nPayload, verifyN8nRequest } from "@/modules/integrations/domain/n8n-policy";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type MachinePrincipal = Readonly<{ id: string; workspaceId: string; actorId: string; scopes: readonly N8nMachineScope[]; tokenVersion: number }>;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(safeN8nPayload(value))) as Prisma.InputJsonValue; }
function fail(message: string, code: string, statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
function resource(context: AuthenticatedContext) { return { workspaceId: context.workspaceId, resourceType: "N8nGovernance", resourceId: context.workspaceId }; }

async function audit(tx: Tx, input: Readonly<{ workspaceId: string; actorId: string; action: string; entityType: string; entityId: string; reason?: string; metadata?: unknown; requestId?: string }>) {
  await tx.auditLog.create({ data: { workspaceId: input.workspaceId, actorId: input.actorId, action: input.action, origin: "API", entityType: input.entityType, entityId: input.entityId, reason: input.reason ?? null, requestId: input.requestId ?? null, metadata: input.metadata === undefined ? Prisma.JsonNull : json(input.metadata), changes: Prisma.JsonNull } });
}

function machineDto(machine: { id: string; key: string; name: string; purpose: string; status: string; tokenFingerprint: string; tokenVersion: number; revision: number; expiresAt: Date; lastUsedAt: Date | null; owner: { id: string; user: { displayName: string } }; permissions: readonly { scope: string }[] }) {
  return { id: machine.id, key: machine.key, name: machine.name, purpose: machine.purpose, status: machine.status, tokenFingerprint: machine.tokenFingerprint, tokenVersion: machine.tokenVersion, revision: machine.revision, expiresAt: machine.expiresAt.toISOString(), lastUsedAt: machine.lastUsedAt?.toISOString() ?? null, owner: { id: machine.owner.id, name: machine.owner.user.displayName }, scopes: machine.permissions.map((item) => item.scope) };
}

const machineInclude = { owner: { include: { user: { select: { displayName: true } } } }, permissions: { orderBy: { scope: "asc" as const } } } as const;

export function createN8nGovernanceService(options: Options) {
  const authorization = createAuthorizationService({ database: options.database });
  const authorizeRead = (context: AuthenticatedContext) => authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_N8N_READ, resource(context));
  const authorizeManage = (context: AuthenticatedContext) => authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_N8N_MANAGE, resource(context));

  async function list(context: AuthenticatedContext) {
    await authorizeRead(context);
    const now = options.now();
    const [machines, recipes, proposals, receipts, eventCounts, owners, manageDecision, reviewDecision] = await Promise.all([
      options.database.n8nMachineIdentity.findMany({ where: { workspaceId: context.workspaceId }, include: machineInclude, orderBy: { createdAt: "desc" }, take: 50 }),
      options.database.n8nRecipe.findMany({ where: { workspaceId: context.workspaceId }, include: { owner: { include: { user: { select: { displayName: true } } } }, versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, take: 50 }),
      options.database.n8nActionProposal.findMany({ where: { workspaceId: context.workspaceId, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 25 }),
      options.database.n8nCommandReceipt.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { receivedAt: "desc" }, take: 25 }),
      options.database.outboxEvent.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId, eventType: { in: [...n8nEventTypes] } }, _count: { _all: true } }),
      options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, user: { select: { displayName: true } } }, orderBy: { user: { displayName: "asc" } } }),
      authorization.authorize(context, PermissionKeys.INTEGRATIONS_N8N_MANAGE, resource(context)),
      authorization.authorize(context, PermissionKeys.INTEGRATIONS_N8N_REVIEW, resource(context)),
    ]);
    return {
      mode: "LOCAL_DETERMINISTIC" as const,
      label: "Sandbox local — n8n não conectado" as const,
      externalEgress: false as const,
      databaseAccess: false as const,
      generatedAt: now.toISOString(),
      permissions: { canManage: manageDecision.allowed, canReview: reviewDecision.allowed },
      eligibleOwners: owners.map((owner) => ({ id: owner.id, name: owner.user.displayName })),
      summary: { machines: machines.length, activeMachines: machines.filter((item) => item.status === "ACTIVE" && item.expiresAt > now).length, activeRecipes: recipes.filter((item) => item.status === "ACTIVE").length, pendingProposals: proposals.length, lastSuccessAt: receipts.find((item) => item.status === "ACCEPTED")?.receivedAt.toISOString() ?? null, lastFailureAt: receipts.find((item) => item.status === "REJECTED")?.receivedAt.toISOString() ?? null, eventsByStatus: Object.fromEntries(eventCounts.map((row) => [row.status, row._count._all])) },
      machines: machines.map(machineDto),
      recipes: recipes.map((item) => ({ id: item.id, key: item.key, name: item.name, purpose: item.purpose, status: item.status, revision: item.revision, currentVersion: item.currentVersion, owner: item.owner.user.displayName, trigger: item.versions[0]?.triggerEventType ?? null, action: item.versions[0]?.actionKind ?? null, requiresConfirmation: item.versions[0]?.requiresConfirmation ?? false })),
      proposals: proposals.map((item) => ({ id: item.id, kind: item.kind, targetType: item.targetType, targetId: item.targetId, reason: item.reason, status: item.status, createdAt: item.createdAt.toISOString(), expiresAt: item.expiresAt.toISOString(), correlationId: item.correlationId })),
      recentCommands: receipts.map((item) => ({ id: item.id, commandType: item.commandType, status: item.status, responseCode: item.responseCode, correlationId: item.correlationId, receivedAt: item.receivedAt.toISOString() })),
      catalog: n8nRecipeCatalog,
    };
  }

  async function createMachine(context: AuthenticatedContext, raw: unknown) {
    await authorizeManage(context);
    const input = createN8nMachineSchema.parse(raw); const expiresAt = new Date(input.expiresAt); const now = options.now();
    if (expiresAt <= now || expiresAt.getTime() > now.getTime() + 90 * 86_400_000) fail("A credencial deve expirar entre agora e 90 dias.", "N8N_MACHINE_EXPIRY_INVALID", 422);
    const token = createEphemeralN8nToken();
    const created = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`n8n-machine:${context.workspaceId}:${input.key}`}, 0))`;
      const owner = await tx.workspaceMember.findFirst({ where: { id: input.ownerMemberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true } });
      if (!owner) fail("Responsável humano ativo não encontrado neste workspace.", "N8N_OWNER_NOT_FOUND", 404);
      if (await tx.n8nMachineIdentity.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.key } } })) fail("Já existe uma identidade com esta chave.", "N8N_MACHINE_KEY_CONFLICT");
      const actor = await tx.actor.create({ data: { workspaceId: context.workspaceId, type: "AUTOMATION", key: `n8n:${input.key}`, displayName: input.name } });
      const machine = await tx.n8nMachineIdentity.create({ data: { workspaceId: context.workspaceId, actorId: actor.id, ownerMemberId: owner.id, key: input.key, name: input.name, purpose: input.purpose, status: "DRAFT", tokenHash: hashN8nToken(token), tokenFingerprint: fingerprintN8nToken(token), expiresAt, createdByActorId: context.actorId, updatedByActorId: context.actorId, permissions: { createMany: { data: input.scopes.map((scope) => ({ scope })) } } }, include: machineInclude });
      await audit(tx, { workspaceId: context.workspaceId, actorId: context.actorId, action: "n8n.machine.created", entityType: "N8nMachineIdentity", entityId: machine.id, metadata: { ownerMemberId: owner.id, scopes: input.scopes, expiresAt: input.expiresAt, tokenFingerprint: machine.tokenFingerprint } });
      return machine;
    });
    return { machine: machineDto(created), credential: token, credentialNotice: "Exibida uma única vez; persista somente em secret manager futuro. Esta credencial é local e expira." };
  }

  async function rotateMachine(context: AuthenticatedContext, raw: unknown) {
    await authorizeManage(context); const input = rotateN8nMachineSchema.parse(raw); const token = createEphemeralN8nToken();
    const machine = await options.database.$transaction(async (tx) => {
      const current = await tx.n8nMachineIdentity.findFirst({ where: { id: input.machineId, workspaceId: context.workspaceId }, select: { revision: true, status: true } });
      if (!current) fail("Identidade de máquina não encontrada.", "N8N_MACHINE_NOT_FOUND", 404);
      if (current.status === "REVOKED") fail("Identidade revogada não pode ser rotacionada.", "N8N_MACHINE_REVOKED");
      const updated = await tx.n8nMachineIdentity.updateMany({ where: { id: input.machineId, workspaceId: context.workspaceId, revision: input.revision }, data: { tokenHash: hashN8nToken(token), tokenFingerprint: fingerprintN8nToken(token), tokenVersion: { increment: 1 }, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (updated.count !== 1) fail("A identidade foi alterada por outra operação.", "N8N_MACHINE_REVISION_CONFLICT");
      await audit(tx, { workspaceId: context.workspaceId, actorId: context.actorId, action: "n8n.machine.rotated", entityType: "N8nMachineIdentity", entityId: input.machineId });
      return tx.n8nMachineIdentity.findUniqueOrThrow({ where: { id: input.machineId }, include: machineInclude });
    });
    return { machine: machineDto(machine), credential: token, credentialNotice: "Credencial rotacionada e exibida uma única vez." };
  }

  async function setMachineStatus(context: AuthenticatedContext, raw: unknown) {
    await authorizeManage(context); const input = setN8nMachineStatusSchema.parse(raw); const now = options.now();
    return options.database.$transaction(async (tx) => {
      const updated = await tx.n8nMachineIdentity.updateMany({ where: { id: input.machineId, workspaceId: context.workspaceId, revision: input.revision, status: { not: "REVOKED" } }, data: { status: input.status, revision: { increment: 1 }, updatedByActorId: context.actorId, revokedAt: input.status === "REVOKED" ? now : null } });
      if (updated.count !== 1) fail("Identidade inexistente, revogada ou desatualizada.", "N8N_MACHINE_REVISION_CONFLICT");
      await audit(tx, { workspaceId: context.workspaceId, actorId: context.actorId, action: `n8n.machine.${input.status.toLowerCase()}`, entityType: "N8nMachineIdentity", entityId: input.machineId, reason: input.reason });
      return machineDto(await tx.n8nMachineIdentity.findUniqueOrThrow({ where: { id: input.machineId }, include: machineInclude }));
    });
  }

  async function setMachineScopes(context: AuthenticatedContext, raw: unknown) {
    await authorizeManage(context); const input = setN8nMachineScopesSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      const current = await tx.n8nMachineIdentity.findFirst({ where: { id: input.machineId, workspaceId: context.workspaceId, revision: input.revision, status: { not: "REVOKED" } }, select: { id: true } });
      if (!current) fail("Identidade inexistente, revogada ou desatualizada.", "N8N_MACHINE_REVISION_CONFLICT");
      await tx.n8nMachinePermission.deleteMany({ where: { workspaceId: context.workspaceId, machineIdentityId: input.machineId } });
      await tx.n8nMachinePermission.createMany({ data: input.scopes.map((scope) => ({ workspaceId: context.workspaceId, machineIdentityId: input.machineId, scope })) });
      await tx.n8nMachineIdentity.update({ where: { id: input.machineId }, data: { revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await audit(tx, { workspaceId: context.workspaceId, actorId: context.actorId, action: "n8n.machine.scopes_changed", entityType: "N8nMachineIdentity", entityId: input.machineId, reason: input.reason, metadata: { scopes: input.scopes } });
      return machineDto(await tx.n8nMachineIdentity.findUniqueOrThrow({ where: { id: input.machineId }, include: machineInclude }));
    });
  }

  async function createRecipe(context: AuthenticatedContext, raw: unknown) {
    await authorizeManage(context); const input = createN8nRecipeSchema.parse(raw); const template = n8nRecipeCatalog.find((item) => item.key === input.catalogKey); if (!template) fail("Receita fora do catálogo permitido.", "N8N_RECIPE_NOT_ALLOWLISTED", 422);
    return options.database.$transaction(async (tx) => {
      const owner = await tx.workspaceMember.findFirst({ where: { id: input.ownerMemberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true } }); if (!owner) fail("Responsável humano ativo não encontrado.", "N8N_OWNER_NOT_FOUND", 404);
      const definition = { trigger: template.trigger, filters: ["workspace fixo", "registro autorizado"], action: template.action, requiresConfirmation: template.confirmation, idempotency: "workspace+machine+key", limits: { bodyBytes: 65536, causationDepth: 4 }, fallback: "quarentena local", observability: ["correlationId", "status", "latency"], prohibitedData: ["segredos", "credenciais humanas", "payload bruto", "SQL"] };
      const recipe = await tx.n8nRecipe.create({ data: { workspaceId: context.workspaceId, ownerMemberId: owner.id, key: template.key, name: template.name, purpose: `Receita local governada: ${template.name}.`, createdByActorId: context.actorId, updatedByActorId: context.actorId, versions: { create: { version: 1, contractVersion: "1.0", triggerEventType: template.trigger, triggerSchemaVersion: "1.0", actionKind: template.action, requiresConfirmation: template.confirmation, definitionHash: sha256(canonicalJson(definition)), definition: json(definition), createdByActorId: context.actorId } } } });
      await audit(tx, { workspaceId: context.workspaceId, actorId: context.actorId, action: "n8n.recipe.created", entityType: "N8nRecipe", entityId: recipe.id, metadata: { catalogKey: template.key, version: 1 } });
      return recipe;
    });
  }

  async function setRecipeStatus(context: AuthenticatedContext, raw: unknown) {
    await authorizeManage(context); const input = setN8nRecipeStatusSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      const changed = await tx.n8nRecipe.updateMany({ where: { id: input.recipeId, workspaceId: context.workspaceId, revision: input.revision, status: { not: "REVOKED" } }, data: { status: input.status, revision: { increment: 1 }, updatedByActorId: context.actorId, revokedAt: input.status === "REVOKED" ? options.now() : null } });
      if (changed.count !== 1) fail("Receita inexistente, revogada ou desatualizada.", "N8N_RECIPE_REVISION_CONFLICT");
      await audit(tx, { workspaceId: context.workspaceId, actorId: context.actorId, action: `n8n.recipe.${input.status.toLowerCase()}`, entityType: "N8nRecipe", entityId: input.recipeId, reason: input.reason });
      return tx.n8nRecipe.findUniqueOrThrow({ where: { id: input.recipeId } });
    });
  }

  async function authenticate(token: string, requiredScope: N8nMachineScope): Promise<MachinePrincipal> {
    const fingerprint = fingerprintN8nToken(token); const machine = await options.database.n8nMachineIdentity.findUnique({ where: { tokenFingerprint: fingerprint }, include: { permissions: true, workspace: { select: { status: true, deletedAt: true } } } });
    if (!machine) fail("Credencial de máquina inválida.", "N8N_MACHINE_UNAUTHENTICATED", 401);
    const supplied = Buffer.from(hashN8nToken(token), "hex"); const expected = Buffer.from(machine.tokenHash, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail("Credencial de máquina inválida.", "N8N_MACHINE_UNAUTHENTICATED", 401);
    if (machine.status !== "ACTIVE") fail("Identidade de máquina não está ativa.", "N8N_MACHINE_DISABLED", 403);
    if (machine.workspace.status !== "ACTIVE" || machine.workspace.deletedAt) fail("Sandbox n8n desativado para este workspace.", "N8N_WORKSPACE_DISABLED", 403);
    if (machine.expiresAt <= options.now()) fail("Credencial de máquina expirada.", "N8N_MACHINE_EXPIRED", 401);
    if (!machine.permissions.some((permission) => permission.scope === requiredScope)) fail("Escopo de máquina insuficiente.", "N8N_MACHINE_SCOPE_DENIED", 403);
    await options.database.n8nMachineIdentity.update({ where: { id: machine.id }, data: { lastUsedAt: options.now() } });
    return { id: machine.id, workspaceId: machine.workspaceId, actorId: machine.actorId, scopes: machine.permissions.map((item) => item.scope), tokenVersion: machine.tokenVersion };
  }

  async function listEvents(token: string, rawQuery: unknown) {
    const principal = await authenticate(token, "EVENTS_READ"); const query = n8nEventQuerySchema.parse(rawQuery);
    const events = await options.database.outboxEvent.findMany({ where: { workspaceId: principal.workspaceId, eventVersion: "1.0", eventType: query.eventType ?? { in: [...n8nEventTypes] }, ...(query.after ? { createdAt: { gt: new Date(query.after) } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: query.limit + 1 });
    const items = events.slice(0, query.limit).map((event) => ({ eventId: event.id, type: event.eventType, schemaVersion: event.eventVersion, workspace: { id: event.workspaceId }, occurredAt: event.createdAt.toISOString(), recordedAt: event.createdAt.toISOString(), asOf: event.createdAt.toISOString(), timezone: "America/Sao_Paulo", aggregateType: event.aggregateType, aggregateId: event.aggregateId, correlationId: event.correlationId, causationId: event.causationId, sequence: `${event.createdAt.toISOString()}:${event.id}`, payload: safeN8nPayload(event.payload), sensitivity: event.dataClass, redaction: "MINIMIZED", fingerprint: event.payloadHash }));
    return { contractVersion: "1.0", items, page: { limit: query.limit, hasMore: events.length > query.limit, nextAfter: items.at(-1)?.recordedAt ?? null } };
  }

  async function getRecord(token: string, type: "lead" | "meeting" | "opportunity" | "account", id: string) {
    const principal = await authenticate(token, "RECORDS_READ");
    const values = {
      lead: () => options.database.lead.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null }, select: { id: true, fullName: true, status: true, priority: true, currentStage: { select: { code: true, name: true } }, nextActionAt: true, nextActionDescription: true, updatedAt: true } }),
      meeting: () => options.database.meeting.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null }, select: { id: true, title: true, status: true, startsAt: true, endsAt: true, timeZone: true, revision: true, updatedAt: true } }),
      opportunity: () => options.database.opportunity.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null }, select: { id: true, name: true, status: true, amountCents: true, mrrCents: true, tcvCents: true, currentStage: { select: { code: true, name: true } }, nextActionAt: true, nextActionDescription: true, revision: true, updatedAt: true } }),
      account: () => options.database.account.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null }, select: { id: true, name: true, status: true, segment: true, size: true, revision: true, updatedAt: true } }),
    } as const;
    const record = await values[type](); if (!record) fail("Registro não encontrado no workspace da máquina.", "N8N_RECORD_NOT_FOUND", 404);
    return { contractVersion: "1.0", type, record: JSON.parse(JSON.stringify(record, (_key, value) => typeof value === "bigint" ? value.toString() : value)), asOf: options.now().toISOString(), timezone: "America/Sao_Paulo" };
  }

  function requiredScope(command: N8nCommand): N8nMachineScope { if (command.type === "DRAFT_ACTIVITY") return "ACTIVITY_DRAFT_CREATE"; if (command.type === "DRAFT_NEXT_ACTION") return "NEXT_ACTION_DRAFT_CREATE"; if (command.type === "AUTOMATION_RESULT") return "AUTOMATION_RESULT_WRITE"; return "ACTION_PROPOSAL_CREATE"; }

  async function receiveCommand(rawBody: string, rawHeaders: unknown) {
    const headers = n8nMachineRequestHeadersSchema.parse(rawHeaders); const token = headers.authorization.slice("Bearer ".length); const command = n8nCommandSchema.parse(JSON.parse(rawBody)); assertCausationDepth(headers.causationDepth);
    const principal = await authenticate(token, requiredScope(command));
    const signature = verifyN8nRequest({ token, timestamp: headers.timestamp, nonce: headers.nonce, idempotencyKey: headers.idempotencyKey, rawBody, signature: headers.signature, now: options.now() });
    if (signature !== "VERIFIED") fail(signature === "EXPIRED" ? "Assinatura fora da janela temporal." : "Assinatura inválida.", signature === "EXPIRED" ? "N8N_SIGNATURE_EXPIRED" : "N8N_SIGNATURE_INVALID", 401);
    const requestHash = sha256(rawBody); const nonceHash = sha256(headers.nonce);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`n8n-command:${principal.workspaceId}:${principal.id}:${headers.idempotencyKey}`}, 0))`;
      const previous = await tx.n8nCommandReceipt.findUnique({ where: { workspaceId_machineIdentityId_idempotencyKey: { workspaceId: principal.workspaceId, machineIdentityId: principal.id, idempotencyKey: headers.idempotencyKey } } });
      if (previous) { if (previous.requestHash !== requestHash) fail("Chave idempotente reutilizada com conteúdo diferente.", "N8N_IDEMPOTENCY_CONFLICT"); return { ...(previous.response as Record<string, unknown>), idempotentReplay: true }; }
      if (await tx.n8nCommandReceipt.findUnique({ where: { workspaceId_machineIdentityId_nonceHash: { workspaceId: principal.workspaceId, machineIdentityId: principal.id, nonceHash } } })) fail("Nonce já utilizado.", "N8N_NONCE_REPLAY", 409);
      const targetExists = command.targetType === "LEAD" ? await tx.lead.findFirst({ where: { id: command.targetId, workspaceId: principal.workspaceId, deletedAt: null }, select: { id: true } }) : command.targetType === "MEETING" ? await tx.meeting.findFirst({ where: { id: command.targetId, workspaceId: principal.workspaceId, deletedAt: null }, select: { id: true } }) : command.targetType === "OPPORTUNITY" ? await tx.opportunity.findFirst({ where: { id: command.targetId, workspaceId: principal.workspaceId, deletedAt: null }, select: { id: true } }) : await tx.account.findFirst({ where: { id: command.targetId, workspaceId: principal.workspaceId, deletedAt: null }, select: { id: true } });
      if (!targetExists) fail("Registro alvo não encontrado no workspace da máquina.", "N8N_TARGET_NOT_FOUND", 404);
      let proposalId: string | null = null;
      if (command.type !== "AUTOMATION_RESULT") { const kind = command.type === "DRAFT_ACTIVITY" ? "DRAFT_ACTIVITY" : command.type === "DRAFT_NEXT_ACTION" ? "DRAFT_NEXT_ACTION" : "CONSEQUENTIAL_ACTION"; const payload = json(command); const proposal = await tx.n8nActionProposal.create({ data: { workspaceId: principal.workspaceId, machineIdentityId: principal.id, kind, targetType: command.targetType, targetId: command.targetId, reason: command.reason, proposedPayload: payload, payloadHash: sha256(canonicalJson(payload)), expectedVersion: command.expectedVersion ?? null, idempotencyKey: headers.idempotencyKey, correlationId: headers.correlationId, causationId: headers.causationId ?? null, causationDepth: headers.causationDepth, expiresAt: new Date(options.now().getTime() + 24 * 3_600_000) } }); proposalId = proposal.id; }
      const response = { accepted: true, code: command.type === "AUTOMATION_RESULT" ? "N8N_RESULT_RECORDED" : "N8N_PROPOSAL_PENDING_HUMAN_REVIEW", proposalId, correlationId: headers.correlationId, humanConfirmationRequired: command.type !== "AUTOMATION_RESULT", externalEgress: false };
      await tx.n8nCommandReceipt.create({ data: { workspaceId: principal.workspaceId, machineIdentityId: principal.id, idempotencyKey: headers.idempotencyKey, nonceHash, requestHash, commandType: command.type, status: "ACCEPTED", responseCode: response.code, response: json(response), correlationId: headers.correlationId, causationId: headers.causationId ?? null, causationDepth: headers.causationDepth, receivedAt: options.now() } });
      await audit(tx, { workspaceId: principal.workspaceId, actorId: principal.actorId, action: command.type === "AUTOMATION_RESULT" ? "n8n.result.recorded" : "n8n.proposal.created", entityType: proposalId ? "N8nActionProposal" : command.targetType, entityId: proposalId ?? command.targetId, requestId: headers.correlationId, metadata: { commandType: command.type, targetType: command.targetType, targetId: command.targetId, causationDepth: headers.causationDepth } });
      return { ...response, idempotentReplay: false };
    });
  }

  async function reviewProposal(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_N8N_REVIEW, resource(context)); const input = reviewN8nProposalSchema.parse(raw); const now = options.now();
    return options.database.$transaction(async (tx) => {
      const proposal = await tx.n8nActionProposal.findFirst({ where: { id: input.proposalId, workspaceId: context.workspaceId }, select: { id: true, status: true, expiresAt: true } }); if (!proposal) fail("Proposta não encontrada.", "N8N_PROPOSAL_NOT_FOUND", 404); if (proposal.status !== "PENDING") fail("A proposta já possui decisão.", "N8N_PROPOSAL_ALREADY_REVIEWED"); if (proposal.expiresAt <= now) { await tx.n8nActionProposal.update({ where: { id: proposal.id }, data: { status: "EXPIRED" } }); fail("A proposta expirou e não pode ser executada.", "N8N_PROPOSAL_EXPIRED"); }
      const updated = await tx.n8nActionProposal.update({ where: { id: proposal.id }, data: { status: input.decision, reviewedByActorId: context.actorId, reviewReason: input.reason, reviewedAt: now } });
      await audit(tx, { workspaceId: context.workspaceId, actorId: context.actorId, action: `n8n.proposal.${input.decision.toLowerCase()}`, entityType: "N8nActionProposal", entityId: proposal.id, reason: input.reason, metadata: { executionPerformed: false, note: "A decisão humana não contorna o serviço de domínio; execução consequencial permanece separada." } });
      return { id: updated.id, status: updated.status, executionPerformed: false, nextStep: "Execute a ação aprovada pelo fluxo normal do CRM, preservando permissões e regras de domínio." };
    });
  }

  return Object.freeze({ list, createMachine, rotateMachine, setMachineStatus, setMachineScopes, createRecipe, setRecipeStatus, authenticate, listEvents, getRecord, receiveCommand, reviewProposal });
}

let singleton: ReturnType<typeof createN8nGovernanceService> | undefined;
export function getN8nGovernanceService() { singleton ??= createN8nGovernanceService({ database: getDatabaseClient(), now: () => new Date() }); return singleton; }
