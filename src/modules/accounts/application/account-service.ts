import { createHash } from "node:crypto";

import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { AccountDetail, AccountListItem } from "@/modules/accounts/domain/account-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const ACCOUNT_IDENTITY_RULE_VERSION = "account-identity-v1";

type AuthorizationPort = Readonly<{
  authorize(context: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<AuthorizationDecision>;
  assertAuthorized(context: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<void>;
}>;

type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;

const segment = z.enum(["PUBLIC_SECTOR", "POLITICAL", "PRIVATE_SECTOR", "NONPROFIT", "OTHER", "UNKNOWN"]);
const size = z.enum(["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE", "UNKNOWN"]);
const roleType = z.enum(["DECISION_MAKER", "CHAMPION", "INFLUENCER", "USER", "FINANCE", "PROCUREMENT", "TECHNICAL", "LEGAL", "OTHER"]);
const influence = z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]);
const authority = z.enum(["NONE", "CONSULTED", "INFLUENCER", "APPROVER", "FINAL_DECISION", "UNKNOWN"]);

const accountInput = z.object({
  name: z.string().trim().min(2).max(200),
  legalName: z.string().trim().max(240).nullable().optional(),
  document: z.string().trim().max(40).nullable().optional(),
  documentType: z.string().trim().max(30).nullable().optional(),
  documentCountryCode: z.string().trim().length(2).nullable().optional(),
  domain: z.string().trim().max(253).nullable().optional(),
  segment: segment.default("UNKNOWN"),
  size: size.default("UNKNOWN"),
  parentAccountId: z.string().uuid().nullable().optional(),
}).strict();

const updateInput = accountInput.partial().extend({ expectedRevision: z.number().int().positive() }).strict();

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

export function normalizeAccountName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function normalizeDocument(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() ?? "";
  return normalized || null;
}

export function normalizeDomain(value: string | null | undefined): string | null {
  const raw = value?.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
  return raw || null;
}

function fingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}

function resource(workspaceId: string, id?: string): ResourceScope {
  return { workspaceId, resourceType: "Account", ...(id ? { resourceId: id } : {}) };
}

async function scopedAccountResource(database: PrismaClient, context: AuthenticatedContext, accountId: string): Promise<ResourceScope> {
  const teamIds = (await database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } })).map((item) => item.teamId);
  const [owned, teamRelated] = await Promise.all([database.account.findFirst({
    where: {
      id: accountId,
      workspaceId: context.workspaceId,
      deletedAt: null,
      OR: [
        { leads: { some: { ownerMemberId: context.memberId, deletedAt: null } } },
        { opportunities: { some: { ownerMemberId: context.memberId, deletedAt: null } } },
        { ownershipAssignments: { some: { memberId: context.memberId, status: "ACTIVE" } } },
      ],
    },
    select: { id: true },
  }), teamIds.length ? database.account.findFirst({ where: { id: accountId, workspaceId: context.workspaceId, deletedAt: null, OR: [{ leads: { some: { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } }, deletedAt: null } } }, { opportunities: { some: { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } }, deletedAt: null } } }, { ownershipAssignments: { some: { status: "ACTIVE", OR: [{ queue: { teamId: { in: teamIds }, deletedAt: null } }, { member: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } }] } } }] }, select: { id: true } }) : Promise.resolve(null)]);
  return { ...resource(context.workspaceId, accountId), ownerMemberId: owned ? context.memberId : null, teamId: teamRelated ? teamIds[0]! : null };
}

async function assertParent(transaction: Prisma.TransactionClient, workspaceId: string, accountId: string | null, parentId: string | null) {
  if (!parentId) return;
  if (parentId === accountId) fail("Uma conta não pode ser pai de si mesma.", "ACCOUNT_HIERARCHY_CYCLE", 409);
  const parent = await transaction.account.findFirst({ where: { id: parentId, workspaceId, deletedAt: null }, select: { id: true, parentAccountId: true } });
  if (!parent) fail("Conta pai não encontrada neste workspace.", "NOT_FOUND", 404);
  let cursor = parent.parentAccountId;
  const visited = new Set([parent.id]);
  while (cursor) {
    if (cursor === accountId || visited.has(cursor)) fail("A hierarquia criaria um ciclo.", "ACCOUNT_HIERARCHY_CYCLE", 409);
    visited.add(cursor);
    const next = await transaction.account.findFirst({ where: { id: cursor, workspaceId }, select: { parentAccountId: true } });
    cursor = next?.parentAccountId ?? null;
  }
}

export function createAccountService(options: Options) {
  async function list(context: AuthenticatedContext, raw: unknown): Promise<{ items: AccountListItem[]; total: number; canWrite: boolean; canReview: boolean }> {
    const readDecision = await options.authorization.authorize(context, PermissionKeys.ACCOUNTS_READ, { ...resource(context.workspaceId), ownerMemberId: context.memberId });
    if (!readDecision.allowed) await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_READ, resource(context.workspaceId));
    const query = z.object({ search: z.string().trim().max(200).default(""), status: z.enum(["ALL", "ACTIVE", "INACTIVE", "MERGED"]).default("ALL"), segment: z.union([z.literal("ALL"), segment]).default("ALL"), size: z.union([z.literal("ALL"), size]).default("ALL"), quality: z.enum(["ALL", "UNKNOWN", "CONFIRMED", "NEEDS_REVIEW"]).default("ALL"), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(100).default(25) }).parse(raw);
    const teamIds = readDecision.allowed && readDecision.scope === "TEAM" ? (await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } })).map((item) => item.teamId) : [];
    const ownership: Prisma.AccountWhereInput = readDecision.allowed && readDecision.scope === "OWN" ? { OR: [{ leads: { some: { ownerMemberId: context.memberId, deletedAt: null } } }, { opportunities: { some: { ownerMemberId: context.memberId, deletedAt: null } } }, { ownershipAssignments: { some: { memberId: context.memberId, status: "ACTIVE" } } }] } : readDecision.allowed && readDecision.scope === "TEAM" ? { OR: [{ leads: { some: { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } }, deletedAt: null } } }, { opportunities: { some: { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } }, deletedAt: null } } }, { ownershipAssignments: { some: { status: "ACTIVE", OR: [{ queue: { teamId: { in: teamIds }, deletedAt: null } }, { member: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } }] } } }] } : {};
    const where: Prisma.AccountWhereInput = { workspaceId: context.workspaceId, deletedAt: null, ...ownership, ...(query.search ? { AND: [{ OR: [{ name: { contains: query.search, mode: "insensitive" } }, { legalName: { contains: query.search, mode: "insensitive" } }, { normalizedDomain: { contains: normalizeDomain(query.search) ?? query.search } }] }] } : {}), ...(query.status !== "ALL" ? { status: query.status } : {}), ...(query.segment !== "ALL" ? { segment: query.segment } : {}), ...(query.size !== "ALL" ? { size: query.size } : {}), ...(query.quality !== "ALL" ? { quality: query.quality } : {}) };
    const [rows, total, writeDecision, reviewDecision] = await Promise.all([options.database.account.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { _count: { select: { contactRoles: { where: { validTo: null } }, opportunities: { where: { status: "OPEN", deletedAt: null } } } } } }), options.database.account.count({ where }), options.authorization.authorize(context, PermissionKeys.ACCOUNTS_WRITE, resource(context.workspaceId)), options.authorization.authorize(context, PermissionKeys.ACCOUNTS_REVIEW, resource(context.workspaceId))]);
    return { total, canWrite: writeDecision.allowed, canReview: reviewDecision.allowed, items: rows.map((row) => ({ id: row.id, name: row.name, legalName: row.legalName, segment: row.segment, size: row.size, status: row.status, quality: row.quality, peopleCount: row._count.contactRoles, openOpportunities: row._count.opportunities, revision: row.revision })) };
  }

  async function get(context: AuthenticatedContext, accountId: string, raw: unknown = {}): Promise<AccountDetail> {
    const pagination = z.object({ page: z.coerce.number().int().min(1).max(100).default(1), pageSize: z.coerce.number().int().min(10).max(50).default(20) }).parse(raw);
    const timelineTake = pagination.page * pagination.pageSize + 1;
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_READ, await scopedAccountResource(options.database, context, accountId));
    const row = await options.database.account.findFirst({ where: { id: accountId, workspaceId: context.workspaceId, deletedAt: null }, include: { parent: { select: { id: true, name: true } }, contactRoles: { where: { validTo: null }, orderBy: { validFrom: "desc" }, include: { contact: { select: { id: true, preferredName: true } } } }, opportunities: { where: { deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, status: true, amountCents: true } }, buyingCommittees: { orderBy: { createdAt: "desc" }, include: { _count: { select: { members: { where: { validTo: null } } } } } } } });
    if (!row) fail("Conta não encontrada.", "NOT_FOUND", 404);
    const [ownership, leads, conversations, contracts, subscriptions, invoices, onboarding, customerSuccess, requests, renewals, expansionSignals, churnEvents, activities, lifecycle, customerEvents, renewalEvents] = await Promise.all([
      options.database.ownershipAssignment.findMany({ where: { workspaceId: context.workspaceId, accountId, status: "ACTIVE" }, orderBy: [{ function: "asc" }, { validFrom: "desc" }], include: { member: { select: { user: { select: { displayName: true } } } }, queue: { select: { name: true } } } }),
      options.database.lead.findMany({ where: { workspaceId: context.workspaceId, accountId, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, fullName: true, status: true, priority: true } }),
      options.database.conversation.findMany({ where: { workspaceId: context.workspaceId, accountId, deletedAt: null }, orderBy: { lastMessageAt: "desc" }, take: 20, select: { id: true, channel: true, status: true, subject: true } }),
      options.database.commercialContract.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, contractNumber: true, status: true, acceptedAt: true } }),
      options.database.subscription.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, subscriptionNumber: true, status: true, currentMrrCents: true } }),
      options.database.invoice.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { dueAt: "desc" }, take: 20, select: { id: true, invoiceNumber: true, status: true, totalCents: true, dueAt: true } }),
      options.database.onboardingCase.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, status: true, nextActionDescription: true, nextActionAt: true } }),
      options.database.customerPortfolioAssignment.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { validFrom: "desc" }, take: 10, select: { id: true, state: true, nextActionDescription: true, nextActionAt: true } }),
      options.database.customerRequest.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, subject: true, status: true, priority: true } }),
      options.database.renewal.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { targetDate: "desc" }, take: 20, select: { id: true, status: true, riskLevel: true, targetDate: true } }),
      options.database.expansionSignal.count({ where: { workspaceId: context.workspaceId, accountId, status: "PENDING_REVIEW" } }),
      options.database.churnEvent.count({ where: { workspaceId: context.workspaceId, accountId } }),
      options.database.activity.findMany({ where: { workspaceId: context.workspaceId, OR: [{ lead: { accountId } }, { opportunity: { accountId } }], deletedAt: null }, orderBy: { occurredAt: "desc" }, take: timelineTake, select: { id: true, type: true, subject: true, occurredAt: true, leadId: true } }),
      options.database.lifecycleHistory.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { enteredAt: "desc" }, take: timelineTake, select: { id: true, toStage: true, enteredAt: true } }),
      options.database.customerSuccessEvent.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { occurredAt: "desc" }, take: timelineTake, select: { id: true, type: true, reason: true, occurredAt: true } }),
      options.database.renewalEvent.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { occurredAt: "desc" }, take: timelineTake, select: { id: true, type: true, reason: true, occurredAt: true, renewalId: true } }),
    ]);
    const timeline = [
      ...activities.map((item) => ({ id: `activity:${item.id}`, type: item.type, title: item.subject, occurredAt: item.occurredAt.toISOString(), provenance: "Activity", href: `/leads/${item.leadId}/historico` })),
      ...lifecycle.map((item) => ({ id: `lifecycle:${item.id}`, type: "LIFECYCLE", title: `Lifecycle: ${item.toStage}`, occurredAt: item.enteredAt.toISOString(), provenance: "LifecycleHistory", href: null })),
      ...customerEvents.map((item) => ({ id: `cs:${item.id}`, type: item.type, title: item.reason, occurredAt: item.occurredAt.toISOString(), provenance: "CustomerSuccessEvent", href: `/customer-success?accountId=${accountId}` })),
      ...renewalEvents.map((item) => ({ id: `renewal:${item.id}`, type: item.type, title: item.reason, occurredAt: item.occurredAt.toISOString(), provenance: "RenewalEvent", href: `/farmer?renewalId=${item.renewalId}` })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
    const timelineStart = (pagination.page - 1) * pagination.pageSize;
    const timelinePage = timeline.slice(timelineStart, timelineStart + pagination.pageSize);
    return { id: row.id, name: row.name, legalName: row.legalName, originalDocument: row.originalDocument, originalDomain: row.originalDomain, segment: row.segment, size: row.size, status: row.status, quality: row.quality, revision: row.revision, parent: row.parent, people: row.contactRoles.map((item) => ({ roleId: item.id, contactId: item.contact.id, name: item.contact.preferredName, roleType: item.roleType, roleTitle: item.roleTitle, influence: item.influence, authority: item.authority, validFrom: item.validFrom.toISOString() })), opportunities: row.opportunities.map((item) => ({ ...item, amountCents: item.amountCents.toString() })), committees: row.buyingCommittees.map((item) => ({ id: item.id, opportunityId: item.opportunityId, name: item.name, status: item.status, members: item._count.members })), ownership: ownership.map((item) => ({ id: item.id, function: item.function, responsible: item.member?.user.displayName ?? item.queue?.name ?? "Fila explícita", validFrom: item.validFrom.toISOString() })), leads: leads.map((item) => ({ id: item.id, name: item.fullName, status: item.status, priority: item.priority, href: `/leads/${item.id}` })), conversations: conversations.map((item) => ({ ...item, href: `/inbox?conversationId=${item.id}` })), contracts: contracts.map((item) => ({ id: item.id, number: item.contractNumber, status: item.status, acceptedAt: item.acceptedAt?.toISOString() ?? null })), subscriptions: subscriptions.map((item) => ({ id: item.id, number: item.subscriptionNumber, status: item.status, mrrCents: item.currentMrrCents.toString() })), invoices: invoices.map((item) => ({ id: item.id, number: item.invoiceNumber, status: item.status, totalCents: item.totalCents.toString(), dueAt: item.dueAt.toISOString() })), onboarding: onboarding.map((item) => ({ id: item.id, status: item.status, nextAction: item.nextActionDescription, nextActionAt: item.nextActionAt.toISOString(), href: `/onboarding?caseId=${item.id}` })), customerSuccess: customerSuccess.map((item) => ({ id: item.id, state: item.state, nextAction: item.nextActionDescription, nextActionAt: item.nextActionAt?.toISOString() ?? null })), requests: requests.map((item) => ({ id: item.id, subject: item.subject, status: item.status, priority: item.priority, href: `/customer-service?requestId=${item.id}` })), renewals: renewals.map((item) => ({ id: item.id, status: item.status, risk: item.riskLevel, targetDate: item.targetDate.toISOString(), href: `/farmer?renewalId=${item.id}` })), expansionSignals, churnEvents, timeline: timelinePage, timelinePage: pagination.page, timelinePageSize: pagination.pageSize, hasMoreTimeline: timeline.length > timelineStart + pagination.pageSize };
  }

  async function create(context: AuthenticatedContext, raw: unknown) {
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_WRITE, resource(context.workspaceId));
    const input = accountInput.parse(raw);
    return options.database.$transaction(async (tx) => {
      await assertParent(tx, context.workspaceId, null, input.parentAccountId ?? null);
      const account = await tx.account.create({ data: { workspaceId: context.workspaceId, name: input.name, normalizedName: normalizeAccountName(input.name), legalName: input.legalName ?? null, originalDocument: input.document ?? null, normalizedDocument: normalizeDocument(input.document), documentType: input.documentType ?? null, documentCountryCode: input.documentCountryCode?.toUpperCase() ?? null, originalDomain: input.domain ?? null, normalizedDomain: normalizeDomain(input.domain), segment: input.segment, size: input.size, parentAccountId: input.parentAccountId ?? null, origin: "MANUAL", createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "account.created", entityType: "Account", entityId: account.id, changes: { name: account.name, segment: account.segment, size: account.size } } });
      return account;
    });
  }

  async function update(context: AuthenticatedContext, accountId: string, raw: unknown) {
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_WRITE, resource(context.workspaceId, accountId));
    const input = updateInput.parse(raw);
    return options.database.$transaction(async (tx) => {
      const current = await tx.account.findFirst({ where: { id: accountId, workspaceId: context.workspaceId, deletedAt: null } });
      if (!current) fail("Conta não encontrada.", "NOT_FOUND", 404);
      if (current.revision !== input.expectedRevision) fail("A conta foi alterada por outra pessoa. Recarregue antes de salvar.", "REVISION_CONFLICT", 409);
      await assertParent(tx, context.workspaceId, accountId, input.parentAccountId === undefined ? current.parentAccountId : input.parentAccountId);
      const updated = await tx.account.update({ where: { id: accountId }, data: { ...(input.name !== undefined ? { name: input.name, normalizedName: normalizeAccountName(input.name) } : {}), ...(input.legalName !== undefined ? { legalName: input.legalName } : {}), ...(input.document !== undefined ? { originalDocument: input.document, normalizedDocument: normalizeDocument(input.document) } : {}), ...(input.documentType !== undefined ? { documentType: input.documentType } : {}), ...(input.documentCountryCode !== undefined ? { documentCountryCode: input.documentCountryCode?.toUpperCase() ?? null } : {}), ...(input.domain !== undefined ? { originalDomain: input.domain, normalizedDomain: normalizeDomain(input.domain) } : {}), ...(input.segment !== undefined ? { segment: input.segment } : {}), ...(input.size !== undefined ? { size: input.size } : {}), ...(input.parentAccountId !== undefined ? { parentAccountId: input.parentAccountId } : {}), revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "account.updated", entityType: "Account", entityId: accountId, changes: { beforeRevision: current.revision, afterRevision: updated.revision } } });
      return updated;
    });
  }

  async function inactivate(context: AuthenticatedContext, accountId: string, expectedRevision: number, reason: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_WRITE, resource(context.workspaceId, accountId));
    if (reason.trim().length < 3) fail("Informe o motivo da inativação.");
    return options.database.$transaction(async (tx) => {
      const result = await tx.account.updateMany({ where: { id: accountId, workspaceId: context.workspaceId, revision: expectedRevision, deletedAt: null }, data: { status: "INACTIVE", revision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (!result.count) fail("Conta não encontrada ou revisão desatualizada.", "REVISION_CONFLICT", 409);
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "account.inactivated", entityType: "Account", entityId: accountId, reason } });
      return { accountId, status: "INACTIVE" as const };
    });
  }

  async function link(context: AuthenticatedContext, raw: unknown) {
    const input = z.object({ accountId: z.string().uuid().nullable(), leadId: z.string().uuid().optional(), opportunityId: z.string().uuid().optional(), reason: z.string().trim().min(3).max(1000) }).refine((v) => Boolean(v.leadId) !== Boolean(v.opportunityId), "Informe lead ou oportunidade.").parse(raw);
    const target = input.leadId
      ? await options.database.lead.findFirst({ where: { id: input.leadId, workspaceId: context.workspaceId, deletedAt: null }, select: { ownerMemberId: true } })
      : await options.database.opportunity.findFirst({ where: { id: input.opportunityId!, workspaceId: context.workspaceId, deletedAt: null }, select: { ownerMemberId: true } });
    if (!target) fail("Lead ou oportunidade não encontrado.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_LINK, { ...resource(context.workspaceId), ownerMemberId: target.ownerMemberId });
    return options.database.$transaction(async (tx) => {
      if (input.accountId && !(await tx.account.findFirst({ where: { id: input.accountId, workspaceId: context.workspaceId, deletedAt: null } }))) fail("Conta não encontrada.", "NOT_FOUND", 404);
      const entityId = input.leadId ?? input.opportunityId!;
      const entityType = input.leadId ? "Lead" : "Opportunity";
      const result = input.leadId ? await tx.lead.updateMany({ where: { id: input.leadId, workspaceId: context.workspaceId, deletedAt: null }, data: { accountId: input.accountId, updatedByActorId: context.actorId } }) : await tx.opportunity.updateMany({ where: { id: input.opportunityId!, workspaceId: context.workspaceId, deletedAt: null }, data: { accountId: input.accountId, updatedByActorId: context.actorId, revision: { increment: 1 } } });
      if (!result.count) fail(`${entityType} não encontrado.`, "NOT_FOUND", 404);
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: input.accountId ? "account.linked" : "account.unlinked", entityType, entityId, reason: input.reason, changes: { accountId: input.accountId } } });
      return { entityType, entityId, accountId: input.accountId };
    });
  }

  async function addRole(context: AuthenticatedContext, raw: unknown) {
    const input = z.object({ accountId: z.string().uuid(), contactId: z.string().uuid(), roleType, roleTitle: z.string().trim().max(200).nullable().optional(), influence: influence.default("UNKNOWN"), authority: authority.default("UNKNOWN"), source: z.enum(["MANUAL", "FORM", "SDR", "CLOSER", "AI_SUGGESTION"]).default("MANUAL"), evidence: z.string().trim().max(2000).nullable().optional() }).parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNT_ROLES_MANAGE, await scopedAccountResource(options.database, context, input.accountId));
    return options.database.$transaction(async (tx) => {
      const [account, contact] = await Promise.all([tx.account.findFirst({ where: { id: input.accountId, workspaceId: context.workspaceId, deletedAt: null } }), tx.contact.findFirst({ where: { id: input.contactId, workspaceId: context.workspaceId, deletedAt: null } })]);
      if (!account || !contact) fail("Conta ou contato não encontrado no workspace.", "NOT_FOUND", 404);
      const created = await tx.accountContactRole.create({ data: { workspaceId: context.workspaceId, ...input, roleTitle: input.roleTitle ?? null, evidence: input.evidence ?? null, validFrom: options.now(), createdByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "account.contact_role.created", entityType: "AccountContactRole", entityId: created.id, changes: { accountId: input.accountId, contactId: input.contactId, roleType: input.roleType } } });
      return created;
    });
  }

  async function endRole(context: AuthenticatedContext, roleId: string, reason: string) {
    const role = await options.database.accountContactRole.findFirst({ where: { id: roleId, workspaceId: context.workspaceId }, select: { accountId: true } });
    if (!role) fail("Papel ativo não encontrado.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNT_ROLES_MANAGE, await scopedAccountResource(options.database, context, role.accountId));
    if (reason.trim().length < 3) fail("Informe o motivo.");
    return options.database.$transaction(async (tx) => {
      const result = await tx.accountContactRole.updateMany({ where: { id: roleId, workspaceId: context.workspaceId, validTo: null }, data: { validTo: options.now(), endedByActorId: context.actorId } });
      if (!result.count) fail("Papel ativo não encontrado.", "NOT_FOUND", 404);
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "account.contact_role.ended", entityType: "AccountContactRole", entityId: roleId, reason } });
      return { roleId, ended: true };
    });
  }

  async function changeRole(context: AuthenticatedContext, raw: unknown) {
    const input = z.object({ roleId: z.string().uuid(), roleType, roleTitle: z.string().trim().max(200).nullable().optional(), influence: influence.default("UNKNOWN"), authority: authority.default("UNKNOWN"), evidence: z.string().trim().max(2000).nullable().optional(), reason: z.string().trim().min(3).max(1000) }).parse(raw);
    const role = await options.database.accountContactRole.findFirst({ where: { id: input.roleId, workspaceId: context.workspaceId }, select: { accountId: true } });
    if (!role) fail("Papel ativo não encontrado.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNT_ROLES_MANAGE, await scopedAccountResource(options.database, context, role.accountId));
    return options.database.$transaction(async (tx) => {
      const current = await tx.accountContactRole.findFirst({ where: { id: input.roleId, workspaceId: context.workspaceId, validTo: null } });
      if (!current) fail("Papel ativo não encontrado.", "NOT_FOUND", 404);
      const endedAt = options.now();
      await tx.accountContactRole.update({ where: { id: current.id }, data: { validTo: endedAt, endedByActorId: context.actorId } });
      const created = await tx.accountContactRole.create({ data: { workspaceId: context.workspaceId, accountId: current.accountId, contactId: current.contactId, roleType: input.roleType, roleTitle: input.roleTitle ?? null, influence: input.influence, authority: input.authority, source: "MANUAL", evidence: input.evidence ?? null, validFrom: endedAt, createdByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "account.contact_role.changed", entityType: "AccountContactRole", entityId: created.id, reason: input.reason, changes: { previousRoleId: current.id, previousRoleType: current.roleType, roleType: created.roleType } } });
      return created;
    });
  }

  async function createCommittee(context: AuthenticatedContext, raw: unknown) {
    const input = z.object({ opportunityId: z.string().uuid(), accountId: z.string().uuid(), name: z.string().trim().min(2).max(200), status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT") }).parse(raw);
    const owner = await options.database.opportunity.findFirst({ where: { id: input.opportunityId, workspaceId: context.workspaceId, deletedAt: null }, select: { ownerMemberId: true } });
    if (!owner) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.BUYING_COMMITTEE_MANAGE, { ...resource(context.workspaceId, input.opportunityId), resourceType: "Opportunity", ownerMemberId: owner.ownerMemberId });
    return options.database.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.findFirst({ where: { id: input.opportunityId, workspaceId: context.workspaceId, deletedAt: null } });
      if (!opportunity) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
      if (opportunity.accountId !== input.accountId) fail("O comitê deve usar a conta vinculada à oportunidade.", "ACCOUNT_MISMATCH", 409);
      const committee = await tx.buyingCommittee.create({ data: { workspaceId: context.workspaceId, ...input, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "buying_committee.created", entityType: "BuyingCommittee", entityId: committee.id, changes: { opportunityId: input.opportunityId, accountId: input.accountId } } });
      return committee;
    });
  }

  async function addCommitteeMember(context: AuthenticatedContext, raw: unknown) {
    const input = z.object({ committeeId: z.string().uuid(), accountContactRoleId: z.string().uuid(), stance: z.enum(["SUPPORTER", "NEUTRAL", "BLOCKER", "UNKNOWN"]).default("UNKNOWN"), roleDescription: z.string().trim().max(500).nullable().optional(), risk: z.string().trim().max(1000).nullable().optional(), objection: z.string().trim().max(1000).nullable().optional(), interest: z.string().trim().max(1000).nullable().optional(), evidence: z.string().trim().max(2000).nullable().optional() }).parse(raw);
    const owner = await options.database.buyingCommittee.findFirst({ where: { id: input.committeeId, workspaceId: context.workspaceId }, select: { opportunity: { select: { ownerMemberId: true } } } });
    if (!owner) fail("Comitê não encontrado.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.BUYING_COMMITTEE_MANAGE, { ...resource(context.workspaceId, input.committeeId), ownerMemberId: owner.opportunity.ownerMemberId });
    return options.database.$transaction(async (tx) => {
      const committee = await tx.buyingCommittee.findFirst({ where: { id: input.committeeId, workspaceId: context.workspaceId, status: { in: ["DRAFT", "ACTIVE"] } } });
      const role = await tx.accountContactRole.findFirst({ where: { id: input.accountContactRoleId, workspaceId: context.workspaceId, validTo: null } });
      if (!committee || !role || committee.accountId !== role.accountId) fail("O papel deve estar ativo e pertencer à conta do comitê.", "ACCOUNT_MISMATCH", 409);
      const member = await tx.buyingCommitteeMember.create({ data: { workspaceId: context.workspaceId, buyingCommitteeId: input.committeeId, accountContactRoleId: input.accountContactRoleId, stance: input.stance, roleDescription: input.roleDescription ?? null, risk: input.risk ?? null, objection: input.objection ?? null, interest: input.interest ?? null, evidence: input.evidence ?? null, validFrom: options.now(), createdByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "buying_committee.member_added", entityType: "BuyingCommitteeMember", entityId: member.id, changes: { committeeId: input.committeeId, accountContactRoleId: input.accountContactRoleId } } });
      return member;
    });
  }

  async function listReviews(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_REVIEW, resource(context.workspaceId));
    return options.database.accountIdentityReview.findMany({ where: { workspaceId: context.workspaceId, status: "OPEN" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100, include: { lead: { select: { id: true, fullName: true, organizationName: true } }, candidates: { include: { account: { select: { id: true, name: true } } } } } });
  }

  async function resolveReview(context: AuthenticatedContext, reviewId: string, raw: unknown) {
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_REVIEW, resource(context.workspaceId, reviewId));
    const input = z.object({ decision: z.enum(["CREATE_ACCOUNT", "LINK_EXISTING", "KEEP_UNLINKED", "DISMISS"]), accountId: z.string().uuid().nullable().optional(), reason: z.string().trim().min(3).max(2000) }).parse(raw);
    return options.database.$transaction(async (tx) => {
      const review = await tx.accountIdentityReview.findFirst({ where: { id: reviewId, workspaceId: context.workspaceId, status: "OPEN" }, include: { lead: true } });
      if (!review) fail("Revisão aberta não encontrada.", "NOT_FOUND", 404);
      let accountId = input.accountId ?? null;
      if (input.decision === "CREATE_ACCOUNT") {
        const account = await tx.account.create({ data: { workspaceId: context.workspaceId, name: review.lead.organizationName!, normalizedName: review.normalizedName, origin: "LEAD_REVIEW", quality: "CONFIRMED", createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        accountId = account.id;
      }
      if (input.decision === "LINK_EXISTING" && !accountId) fail("Selecione a conta existente.");
      if (accountId) {
        const exists = await tx.account.findFirst({ where: { id: accountId, workspaceId: context.workspaceId, deletedAt: null } });
        if (!exists) fail("Conta não encontrada.", "NOT_FOUND", 404);
        await tx.lead.update({ where: { id: review.leadId }, data: { accountId, updatedByActorId: context.actorId } });
      }
      const status = input.decision === "DISMISS" ? "DISMISSED" : "RESOLVED";
      await tx.accountIdentityReview.update({ where: { id: review.id }, data: { status, decision: input.decision, candidateAccountId: accountId, resolutionReason: input.reason, resolvedAt: options.now(), resolvedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "account.identity_review.resolved", entityType: "AccountIdentityReview", entityId: review.id, reason: input.reason, changes: { decision: input.decision, accountId } } });
      return { reviewId, decision: input.decision, accountId };
    });
  }

  async function createLegacyCandidates(context: AuthenticatedContext, mode: "DRY_RUN" | "EXECUTE" = "DRY_RUN") {
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_BACKFILL, resource(context.workspaceId));
    const leads = await options.database.lead.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, accountId: null, organizationName: { not: null } }, orderBy: { id: "asc" }, select: { id: true, contactId: true, organizationName: true } });
    if (mode === "DRY_RUN") return { mode, eligible: leads.filter((lead) => Boolean(lead.organizationName?.trim())).length, created: 0 };
    return options.database.$transaction(async (tx) => {
      const runKey = `${ACCOUNT_IDENTITY_RULE_VERSION}:${context.workspaceId}`;
      const run = await tx.accountBackfillRun.upsert({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey } }, create: { workspaceId: context.workspaceId, runKey, ruleVersion: ACCOUNT_IDENTITY_RULE_VERSION, mode: "EXECUTE", status: "RUNNING", eligibleCount: leads.length, requestedByActorId: context.actorId, updatedByActorId: context.actorId, startedAt: options.now() }, update: { status: "RUNNING", updatedByActorId: context.actorId } });
      let created = 0;
      for (const lead of leads) {
        const name = lead.organizationName?.trim();
        if (!name) continue;
        const normalizedName = normalizeAccountName(name);
        const reviewFingerprint = fingerprint([ACCOUNT_IDENTITY_RULE_VERSION, context.workspaceId, lead.id, normalizedName]);
        const existingItem = await tx.accountBackfillItem.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: reviewFingerprint } }, select: { id: true } });
        const review = await tx.accountIdentityReview.upsert({ where: { workspaceId_fingerprint: { workspaceId: context.workspaceId, fingerprint: reviewFingerprint } }, create: { workspaceId: context.workspaceId, leadId: lead.id, contactId: lead.contactId, normalizedName, reason: "LEGACY_ORGANIZATION_REQUIRES_HUMAN_REVIEW", fingerprint: reviewFingerprint, evidence: { facts: { organizationName: name }, inference: { automaticLinkPerformed: false }, missingData: ["document", "domain"] }, createdByActorId: context.actorId }, update: {} });
        const candidates = await tx.account.findMany({ where: { workspaceId: context.workspaceId, normalizedName, deletedAt: null }, select: { id: true }, take: 10 });
        for (const candidate of candidates) {
          await tx.accountCandidate.upsert({ where: { workspaceId_reviewId_accountId: { workspaceId: context.workspaceId, reviewId: review.id, accountId: candidate.id } }, create: { workspaceId: context.workspaceId, reviewId: review.id, accountId: candidate.id, name, scoreBps: 10_000, evidence: { ruleVersion: ACCOUNT_IDENTITY_RULE_VERSION, matchReason: "NORMALIZED_NAME_MATCH", exactNormalizedName: true } }, update: {} });
        }
        const item = await tx.accountBackfillItem.upsert({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: reviewFingerprint } }, create: { workspaceId: context.workspaceId, runId: run.id, leadId: lead.id, reviewId: review.id, ruleVersion: ACCOUNT_IDENTITY_RULE_VERSION, idempotencyKey: reviewFingerprint, outcome: "CANDIDATE_CREATED" }, update: {} });
        if (!existingItem && item.id) created += 1;
      }
      await tx.accountBackfillRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", processedCount: leads.length, reviewsCreated: created, finishedAt: options.now(), updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "account.backfill.completed", entityType: "AccountBackfillRun", entityId: run.id, changes: { eligible: leads.length, created, automaticAccountsCreated: 0 } } });
      return { mode, eligible: leads.length, created, runId: run.id };
    });
  }

  return Object.freeze({ list, get, create, update, inactivate, link, addRole, endRole, changeRole, createCommittee, addCommitteeMember, listReviews, resolveReview, createLegacyCandidates });
}

let singleton: ReturnType<typeof createAccountService> | undefined;
export function getAccountService() {
  singleton ??= createAccountService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
