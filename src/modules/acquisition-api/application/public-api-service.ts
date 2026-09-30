import { Prisma, type N8nMachineScope, type PrismaClient, type Prisma as PrismaNamespace } from "@/generated/prisma/client";
import { createOutboxEventInTransaction } from "@/modules/integrations/application/integration-platform-service";
import { createN8nGovernanceService } from "@/modules/integrations/application/n8n-governance-service";
import { safeN8nPayload } from "@/modules/integrations/domain/n8n-policy";
import { API_CONTRACT_VERSION, apiListQuerySchema, createPayloadSchemas, deletePayloadSchema, updatePayloadSchemas, type ApiResource } from "@/modules/acquisition-api/domain/public-api-contracts";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Principal = Readonly<{ id: string; workspaceId: string; actorId: string }>;
type Tx = PrismaNamespace.TransactionClient;
type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

function fail(message: string, code: string, statusCode = 400): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
function serialize(value: unknown): unknown { return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry)); }
function normalizeName(value: string): string { return value.trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim(); }
function defined(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)); }
function token(requestToken: string) { if (!requestToken) fail("Credencial Bearer ausente.", "API_UNAUTHENTICATED", 401); return requestToken; }
function encodeCursor(date: Date, id: string) { return Buffer.from(`${date.toISOString()}|${id}`, "utf8").toString("base64url"); }
function decodeCursor(raw?: string): { updatedAt: Date; id: string } | null {
  if (!raw) return null;
  try { const [date, id, extra] = Buffer.from(raw, "base64url").toString("utf8").split("|"); if (!date || !id || extra || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error(); const updatedAt = new Date(date); if (Number.isNaN(updatedAt.getTime())) throw new Error(); return { updatedAt, id }; } catch { fail("Cursor inválido.", "API_CURSOR_INVALID", 400); }
}

export function createPublicApiService(options: Options) {
  const machineAuth = createN8nGovernanceService({ database: options.database, now: options.now });
  async function authenticate(rawToken: string, scope: N8nMachineScope): Promise<Principal> { return machineAuth.authenticate(token(rawToken), scope); }

  async function list(rawToken: string, resource: ApiResource, rawQuery: unknown) {
    const principal = await authenticate(rawToken, "RECORDS_READ"); const query = apiListQuerySchema.parse(rawQuery); const cursor = decodeCursor(query.cursor);
    const pageWhere = cursor ? { OR: [{ updatedAt: { gt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { gt: cursor.id } }] } : {};
    const take = query.limit + 1;
    const rows = resource === "contacts" ? await options.database.contact.findMany({ where: { workspaceId: principal.workspaceId, deletedAt: null, ...pageWhere }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, preferredName: true, legalName: true, jobTitle: true, timeZone: true, locale: true, status: true, quality: true, updatedAt: true } })
      : resource === "accounts" ? await options.database.account.findMany({ where: { workspaceId: principal.workspaceId, deletedAt: null, ...pageWhere }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, name: true, legalName: true, segment: true, size: true, status: true, quality: true, revision: true, updatedAt: true } })
      : resource === "deals" ? await options.database.opportunity.findMany({ where: { workspaceId: principal.workspaceId, deletedAt: null, ...pageWhere }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, leadId: true, accountId: true, ownerMemberId: true, name: true, status: true, amountCents: true, probabilityBps: true, expectedCloseAt: true, revision: true, updatedAt: true } })
      : resource === "sources" ? await options.database.leadSource.findMany({ where: { workspaceId: principal.workspaceId, deletedAt: null, ...pageWhere }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, key: true, name: true, type: true, externalRef: true, updatedAt: true } })
      : await options.database.customFieldDefinition.findMany({ where: { workspaceId: principal.workspaceId, ...pageWhere }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, entityType: true, key: true, name: true, dataType: true, options: true, required: true, active: true, revision: true, updatedAt: true } });
    const items = rows.slice(0, query.limit); const last = items.at(-1);
    return { contractVersion: API_CONTRACT_VERSION, resource, items: serialize(items), page: { limit: query.limit, hasMore: rows.length > query.limit, nextCursor: rows.length > query.limit && last ? encodeCursor(last.updatedAt, last.id) : null } };
  }

  async function get(rawToken: string, resource: ApiResource, id: string) {
    const principal = await authenticate(rawToken, "RECORDS_READ");
    const row = resource === "contacts" ? await options.database.contact.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null } }) : resource === "accounts" ? await options.database.account.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null } }) : resource === "deals" ? await options.database.opportunity.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null } }) : resource === "sources" ? await options.database.leadSource.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null } }) : await options.database.customFieldDefinition.findFirst({ where: { id, workspaceId: principal.workspaceId } });
    if (!row) fail("Registro não encontrado.", "API_RECORD_NOT_FOUND", 404);
    return { contractVersion: API_CONTRACT_VERSION, resource, record: serialize(row) };
  }

  async function executeWrite(rawToken: string, idempotencyKey: string, commandType: string, raw: unknown, work: (tx: Tx, principal: Principal) => Promise<unknown>) {
    if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(idempotencyKey)) fail("Idempotency-Key inválida ou ausente.", "API_IDEMPOTENCY_KEY_INVALID", 400);
    const principal = await authenticate(rawToken, "RECORDS_WRITE"); const requestHash = sha256(canonicalJson(raw));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`public-api:${principal.workspaceId}:${principal.id}:${idempotencyKey}`}, 0))`;
      const existing = await tx.n8nCommandReceipt.findUnique({ where: { workspaceId_machineIdentityId_idempotencyKey: { workspaceId: principal.workspaceId, machineIdentityId: principal.id, idempotencyKey } } });
      if (existing) { if (existing.requestHash !== requestHash || existing.commandType !== commandType) fail("Idempotency-Key reutilizada com outra operação.", "API_IDEMPOTENCY_CONFLICT", 409); return { ...(existing.response as Record<string, unknown>), idempotentReplay: true }; }
      const result = await work(tx, principal); const response = { contractVersion: API_CONTRACT_VERSION, result: serialize(result), idempotentReplay: false };
      await tx.n8nCommandReceipt.create({ data: { workspaceId: principal.workspaceId, machineIdentityId: principal.id, idempotencyKey, nonceHash: sha256(`api:${idempotencyKey}`), requestHash, commandType, status: "ACCEPTED", responseCode: "OK", response: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue, correlationId: idempotencyKey, receivedAt: options.now() } });
      return response;
    });
  }

  async function writeAuditAndOutbox(tx: Tx, principal: Principal, resource: ApiResource, id: string, verb: string, changes: unknown, idempotencyKey: string) {
    await tx.auditLog.create({ data: { workspaceId: principal.workspaceId, actorId: principal.actorId, action: `public_api.${resource}.${verb}`, origin: "API", entityType: resource, entityId: id, changes: JSON.parse(JSON.stringify(safeN8nPayload(changes))) as Prisma.InputJsonValue } });
    const event = await createOutboxEventInTransaction(tx, { workspaceId: principal.workspaceId, actorId: principal.actorId, eventType: `crm.${resource}.${verb}`, aggregateType: resource, aggregateId: id, correlationId: idempotencyKey, idempotencyKey: `public-api:${principal.id}:${idempotencyKey}`, payload: { id, resource, verb } });
    await tx.outboxEvent.update({ where: { id: event.id }, data: { status: "DELIVERED_LOCAL", deliveredLocallyAt: options.now() } });
  }

  async function create(rawToken: string, resource: ApiResource, idempotencyKey: string, raw: unknown) {
    const input = createPayloadSchemas[resource].parse(raw);
    return executeWrite(rawToken, idempotencyKey, `${resource}.create`, input, async (tx, principal) => {
      let row: { id: string } & Record<string, unknown>;
      if (resource === "contacts") row = await tx.contact.create({ data: defined({ workspaceId: principal.workspaceId, ...input as ReturnType<typeof createPayloadSchemas.contacts.parse>, origin: "MANUAL", createdByActorId: principal.actorId, updatedByActorId: principal.actorId }) as Prisma.ContactUncheckedCreateInput });
      else if (resource === "accounts") { const value = input as ReturnType<typeof createPayloadSchemas.accounts.parse>; row = await tx.account.create({ data: defined({ workspaceId: principal.workspaceId, ...value, normalizedName: normalizeName(value.name), origin: "MANUAL", createdByActorId: principal.actorId, updatedByActorId: principal.actorId }) as Prisma.AccountUncheckedCreateInput }); }
      else if (resource === "sources") row = await tx.leadSource.create({ data: defined({ workspaceId: principal.workspaceId, ...input as ReturnType<typeof createPayloadSchemas.sources.parse>, createdByActorId: principal.actorId, updatedByActorId: principal.actorId }) as Prisma.LeadSourceUncheckedCreateInput });
      else if (resource === "fields") { const value = input as ReturnType<typeof createPayloadSchemas.fields.parse>; if ((value.dataType === "SELECT" || value.dataType === "MULTI_SELECT") && !value.options?.length) fail("Campos de seleção exigem opções.", "API_FIELD_OPTIONS_REQUIRED", 422); row = await tx.customFieldDefinition.create({ data: { workspaceId: principal.workspaceId, ...value, options: value.options ?? Prisma.JsonNull, createdByActorId: principal.actorId, updatedByActorId: principal.actorId } }); }
      else {
        const value = input as ReturnType<typeof createPayloadSchemas.deals.parse>;
        const [lead, owner, pipeline, account] = await Promise.all([
          tx.lead.findFirst({ where: { id: value.leadId, workspaceId: principal.workspaceId, deletedAt: null } }),
          tx.workspaceMember.findFirst({ where: { id: value.ownerMemberId, workspaceId: principal.workspaceId, status: "ACTIVE", deletedAt: null } }),
          tx.pipeline.findFirst({ where: { workspaceId: principal.workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null }, include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" }, take: 1 } } }),
          value.accountId ? tx.account.findFirst({ where: { id: value.accountId, workspaceId: principal.workspaceId, deletedAt: null } }) : Promise.resolve(true),
        ]);
        if (!lead || !owner || !pipeline?.stages[0] || !account) fail("Lead, conta, responsável ou pipeline padrão inválido.", "API_DEAL_REFERENCE_INVALID", 422);
        const createdAt = options.now();
        row = await tx.opportunity.create({ data: { workspaceId: principal.workspaceId, leadId: value.leadId, ownerMemberId: value.ownerMemberId, accountId: value.accountId ?? null, pipelineId: pipeline.id, currentStageId: pipeline.stages[0].id, name: value.name, interestDescription: value.interestDescription, amountCents: BigInt(value.amountCents), probabilityBps: value.probabilityPercent * 100, expectedCloseAt: value.expectedCloseAt ? new Date(value.expectedCloseAt) : null, createdByActorId: principal.actorId, updatedByActorId: principal.actorId, createdAt, updatedAt: createdAt } });
        await tx.stageHistory.create({ data: { workspaceId: principal.workspaceId, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, opportunityId: row.id, enteredAt: createdAt, enteredByActorId: principal.actorId, transitionOrigin: "SYSTEM", transitionReason: "Negócio criado pela API pública versionada." } });
        await tx.activity.create({ data: { workspaceId: principal.workspaceId, leadId: value.leadId, opportunityId: row.id, type: "STAGE_CHANGE", direction: "INTERNAL", result: "INFORMATION", subject: `Negócio criado pela API: ${value.name}`, occurredAt: createdAt, newValues: { stageId: pipeline.stages[0].id, origin: "PUBLIC_API" }, createdByActorId: principal.actorId, updatedByActorId: principal.actorId, createdAt, updatedAt: createdAt } });
      }
      await writeAuditAndOutbox(tx, principal, resource, row.id, "created", { input }, idempotencyKey); return row;
    });
  }

  async function update(rawToken: string, resource: ApiResource, id: string, idempotencyKey: string, raw: unknown) {
    const input = updatePayloadSchemas[resource].parse(raw);
    return executeWrite(rawToken, idempotencyKey, `${resource}.update`, { id, input }, async (tx, principal) => {
      let row: { id: string } & Record<string, unknown>;
      if (resource === "contacts") { const { expectedUpdatedAt, ...data } = input as ReturnType<typeof updatePayloadSchemas.contacts.parse>; const changed = await tx.contact.updateMany({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, updatedAt: new Date(expectedUpdatedAt) }, data: defined({ ...data, updatedByActorId: principal.actorId }) as Prisma.ContactUncheckedUpdateManyInput }); if (!changed.count) fail("Contato ausente ou desatualizado.", "API_REVISION_CONFLICT", 409); row = await tx.contact.findUniqueOrThrow({ where: { id } }); }
      else if (resource === "accounts") { const { expectedRevision, ...data } = input as ReturnType<typeof updatePayloadSchemas.accounts.parse>; const changed = await tx.account.updateMany({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, revision: expectedRevision }, data: defined({ ...data, ...(data.name ? { normalizedName: normalizeName(data.name) } : {}), revision: { increment: 1 }, updatedByActorId: principal.actorId }) as Prisma.AccountUncheckedUpdateManyInput }); if (!changed.count) fail("Conta ausente ou desatualizada.", "API_REVISION_CONFLICT", 409); row = await tx.account.findUniqueOrThrow({ where: { id } }); }
      else if (resource === "deals") { const { expectedRevision, amountCents, probabilityPercent, expectedCloseAt, ...data } = input as ReturnType<typeof updatePayloadSchemas.deals.parse>; const changed = await tx.opportunity.updateMany({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, revision: expectedRevision }, data: defined({ ...data, ...(amountCents !== undefined ? { amountCents: BigInt(amountCents) } : {}), ...(probabilityPercent !== undefined ? { probabilityBps: probabilityPercent * 100 } : {}), ...(expectedCloseAt !== undefined ? { expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : null } : {}), revision: { increment: 1 }, updatedByActorId: principal.actorId }) as Prisma.OpportunityUncheckedUpdateManyInput }); if (!changed.count) fail("Negócio ausente ou desatualizado.", "API_REVISION_CONFLICT", 409); row = await tx.opportunity.findUniqueOrThrow({ where: { id } }); }
      else if (resource === "sources") { const { expectedUpdatedAt, ...data } = input as ReturnType<typeof updatePayloadSchemas.sources.parse>; const changed = await tx.leadSource.updateMany({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, updatedAt: new Date(expectedUpdatedAt) }, data: defined({ ...data, updatedByActorId: principal.actorId }) as Prisma.LeadSourceUncheckedUpdateManyInput }); if (!changed.count) fail("Origem ausente ou desatualizada.", "API_REVISION_CONFLICT", 409); row = await tx.leadSource.findUniqueOrThrow({ where: { id } }); }
      else { const { expectedRevision, options: fieldOptions, ...data } = input as ReturnType<typeof updatePayloadSchemas.fields.parse>; const optionsValue = data.dataType && !["SELECT", "MULTI_SELECT"].includes(data.dataType) ? Prisma.JsonNull : fieldOptions; if ((data.dataType === "SELECT" || data.dataType === "MULTI_SELECT") && !fieldOptions?.length) fail("Campos de seleção exigem opções.", "API_FIELD_OPTIONS_REQUIRED", 422); const changed = await tx.customFieldDefinition.updateMany({ where: { id, workspaceId: principal.workspaceId, revision: expectedRevision }, data: defined({ ...data, ...(optionsValue !== undefined ? { options: optionsValue } : {}), revision: { increment: 1 }, updatedByActorId: principal.actorId }) as Prisma.CustomFieldDefinitionUncheckedUpdateManyInput }); if (!changed.count) fail("Campo ausente ou desatualizado.", "API_REVISION_CONFLICT", 409); row = await tx.customFieldDefinition.findUniqueOrThrow({ where: { id } }); }
      await writeAuditAndOutbox(tx, principal, resource, row.id, "updated", { input }, idempotencyKey); return row;
    });
  }

  async function remove(rawToken: string, resource: ApiResource, id: string, idempotencyKey: string, raw: unknown) {
    const input = deletePayloadSchema.parse(raw);
    if ((resource === "contacts" || resource === "sources") ? !input.expectedUpdatedAt : !input.expectedRevision) fail("Informe a precondição de versão para excluir.", "API_PRECONDITION_REQUIRED", 428);
    return executeWrite(rawToken, idempotencyKey, `${resource}.delete`, { id, input }, async (tx, principal) => {
      const now = options.now(); let count = 0;
      if (resource === "contacts") count = (await tx.contact.updateMany({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, ...(input.expectedUpdatedAt ? { updatedAt: new Date(input.expectedUpdatedAt) } : {}) }, data: { status: "INACTIVE", deletedAt: now, updatedByActorId: principal.actorId } })).count;
      else if (resource === "accounts") count = (await tx.account.updateMany({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, ...(input.expectedRevision ? { revision: input.expectedRevision } : {}) }, data: { status: "INACTIVE", deletedAt: now, revision: { increment: 1 }, updatedByActorId: principal.actorId } })).count;
      else if (resource === "deals") {
        const opportunity = await tx.opportunity.findFirst({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, ...(input.expectedRevision ? { revision: input.expectedRevision } : {}) }, select: { id: true, leadId: true, name: true, stageHistory: { where: { exitedAt: null }, orderBy: { enteredAt: "desc" }, take: 1, select: { enteredAt: true } } } });
        if (opportunity) {
          const enteredAt = opportunity.stageHistory[0]?.enteredAt;
          const effectiveAt = enteredAt && now <= enteredAt ? new Date(enteredAt.getTime() + 1) : now;
          count = (await tx.opportunity.updateMany({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, ...(input.expectedRevision ? { revision: input.expectedRevision } : {}) }, data: { status: "CANCELLED", closedAt: effectiveAt, outcomeReasonCode: input.reason, deletedAt: effectiveAt, revision: { increment: 1 }, updatedByActorId: principal.actorId, updatedAt: effectiveAt } })).count;
          if (count) {
            await tx.stageHistory.updateMany({ where: { workspaceId: principal.workspaceId, opportunityId: id, exitedAt: null }, data: { exitedAt: effectiveAt, exitedByActorId: principal.actorId } });
            await tx.task.updateMany({ where: { workspaceId: principal.workspaceId, opportunityId: id, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, data: { status: "CANCELLED", result: "Cancelada pela remoção explícita via API pública.", updatedByActorId: principal.actorId, updatedAt: effectiveAt } });
            await tx.activity.create({ data: { workspaceId: principal.workspaceId, leadId: opportunity.leadId, opportunityId: id, type: "STAGE_CHANGE", direction: "INTERNAL", result: "INFORMATION", subject: `Negócio removido pela API: ${opportunity.name}`, description: input.reason, occurredAt: effectiveAt, newValues: { status: "CANCELLED", deleted: true, origin: "PUBLIC_API" }, createdByActorId: principal.actorId, updatedByActorId: principal.actorId, createdAt: effectiveAt, updatedAt: effectiveAt } });
          }
        }
      }
      else if (resource === "sources") count = (await tx.leadSource.updateMany({ where: { id, workspaceId: principal.workspaceId, deletedAt: null, ...(input.expectedUpdatedAt ? { updatedAt: new Date(input.expectedUpdatedAt) } : {}) }, data: { deletedAt: now, updatedByActorId: principal.actorId } })).count;
      else count = (await tx.customFieldDefinition.updateMany({ where: { id, workspaceId: principal.workspaceId, ...(input.expectedRevision ? { revision: input.expectedRevision } : {}) }, data: { active: false, revision: { increment: 1 }, updatedByActorId: principal.actorId } })).count;
      if (!count) fail("Registro ausente ou desatualizado.", "API_REVISION_CONFLICT", 409); await writeAuditAndOutbox(tx, principal, resource, id, "deleted", { reason: input.reason }, idempotencyKey); return { id, deleted: true };
    });
  }
  return Object.freeze({ list, get, create, update, remove });
}

let singleton: ReturnType<typeof createPublicApiService> | undefined;
export function getPublicApiService() { singleton ??= createPublicApiService({ database: getDatabaseClient(), now: () => new Date() }); return singleton; }
