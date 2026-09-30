import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  configureConsumptionBudgetSchema,
  evaluateConsumption,
  grantConsumptionCreditSchema,
  recordConsumptionSchema,
  type ConsumptionResourceType,
} from "@/modules/consumption/domain/consumption-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Readonly<{
  assertAuthorized: (
    context: AuthenticatedContext,
    permission: typeof PermissionKeys.OPERATIONS_READ | typeof PermissionKeys.OPERATIONS_MANAGE,
    resource: { workspaceId: string; resourceType: "Workspace"; resourceId: string },
  ) => Promise<void>;
}>;

type ServiceOptions = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now?: () => Date }>;
type UsagePrincipal = Readonly<{ workspaceId: string; actorId: string }>;

const workspaceResource = (workspaceId: string) => ({ workspaceId, resourceType: "Workspace" as const, resourceId: workspaceId });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const serialized = (value: unknown) => json(value);

function budgetView(budget: {
  id: string; workspaceId: string; resourceType: string; resourceKey: string; status: string; currency: string;
  limitCents: bigint | null; limitUnits: bigint | null; includedCreditCents: bigint; warningBasisPoints: number;
  periodStart: Date; periodEnd: Date; pausedAt: Date | null; pausedReason: string | null; revision: number;
}) {
  return {
    ...budget,
    limitCents: budget.limitCents?.toString() ?? null,
    limitUnits: budget.limitUnits?.toString() ?? null,
    includedCreditCents: budget.includedCreditCents.toString(),
    periodStart: budget.periodStart.toISOString(),
    periodEnd: budget.periodEnd.toISOString(),
    pausedAt: budget.pausedAt?.toISOString() ?? null,
  };
}

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

export function createConsumptionGovernanceService(options: ServiceOptions) {
  const now = options.now ?? (() => new Date());

  async function totals(tx: PrismaClient | Prisma.TransactionClient, workspaceId: string, budgetId: string) {
    const [debits, credits] = await Promise.all([
      tx.consumptionLedgerEntry.aggregate({ where: { workspaceId, budgetId, kind: "DEBIT" }, _sum: { amountCents: true, units: true } }),
      tx.consumptionLedgerEntry.aggregate({ where: { workspaceId, budgetId, kind: "CREDIT" }, _sum: { amountCents: true } }),
    ]);
    return {
      spentCents: debits._sum.amountCents ?? 0n,
      consumedUnits: debits._sum.units ?? 0n,
      creditedCents: credits._sum.amountCents ?? 0n,
    };
  }

  async function configure(context: AuthenticatedContext, raw: unknown) {
    await options.authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context.workspaceId));
    const input = configureConsumptionBudgetSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consumption:${context.workspaceId}:${input.resourceType}:${input.resourceKey}`}, 0))`;
      const overlap = await tx.consumptionBudget.findFirst({
        where: {
          workspaceId: context.workspaceId,
          resourceType: input.resourceType,
          resourceKey: input.resourceKey,
          periodStart: { lt: input.periodEnd },
          periodEnd: { gt: input.periodStart },
        },
      });
      if (overlap && overlap.periodStart.getTime() !== input.periodStart.getTime()) {
        fail("Já existe orçamento sobreposto para este recurso.", "CONSUMPTION_BUDGET_PERIOD_OVERLAP");
      }
      const budget = overlap
        ? await tx.consumptionBudget.update({
            where: { id: overlap.id },
            data: {
              currency: input.currency.toUpperCase(), limitCents: input.limitCents ?? null, limitUnits: input.limitUnits ?? null,
              includedCreditCents: input.includedCreditCents, warningBasisPoints: input.warningBasisPoints, periodEnd: input.periodEnd,
              status: input.status, pausedAt: input.status === "PAUSED" ? now() : null, pausedReason: input.status === "PAUSED" ? input.reason : null,
              revision: { increment: 1 }, updatedByActorId: context.actorId,
            },
          })
        : await tx.consumptionBudget.create({
            data: {
              workspaceId: context.workspaceId, resourceType: input.resourceType, resourceKey: input.resourceKey,
              currency: input.currency.toUpperCase(), limitCents: input.limitCents ?? null, limitUnits: input.limitUnits ?? null,
              includedCreditCents: input.includedCreditCents, warningBasisPoints: input.warningBasisPoints,
              periodStart: input.periodStart, periodEnd: input.periodEnd, status: input.status,
              pausedAt: input.status === "PAUSED" ? now() : null, pausedReason: input.status === "PAUSED" ? input.reason : null,
              createdByActorId: context.actorId, updatedByActorId: context.actorId,
            },
          });
      await tx.auditLog.create({ data: {
        workspaceId: context.workspaceId, actorId: context.actorId, action: overlap ? "consumption.budget.updated" : "consumption.budget.created",
        origin: "DOMAIN", entityType: "ConsumptionBudget", entityId: budget.id, reason: input.reason,
        changes: serialized({ after: { resourceType: budget.resourceType, resourceKey: budget.resourceKey, status: budget.status, limitCents: budget.limitCents?.toString() ?? null, limitUnits: budget.limitUnits?.toString() ?? null, periodStart: budget.periodStart, periodEnd: budget.periodEnd, revision: budget.revision } }),
      } });
      return budgetView(budget);
    }, { isolationLevel: "Serializable" });
  }

  async function record(context: UsagePrincipal, raw: unknown) {
    const input = recordConsumptionSchema.parse(raw);
    const occurredAt = input.occurredAt ?? now();
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consumption:${context.workspaceId}:${input.resourceType}:${input.resourceKey}`}, 0))`;
      const replay = await tx.consumptionLedgerEntry.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay) {
        if (replay.resourceType !== input.resourceType || replay.resourceKey !== input.resourceKey || replay.amountCents !== input.amountCents || replay.units !== input.units) {
          fail("A chave idempotente já foi usada com outro consumo.", "CONSUMPTION_IDEMPOTENCY_CONFLICT");
        }
        return { allowed: replay.kind === "DEBIT", code: replay.kind === "DEBIT" ? "ALLOWED" as const : replay.reason ?? "BUDGET_PAUSED", budgetId: replay.budgetId, ledgerEntryId: replay.id, warning: false, idempotent: true };
      }
      const budget = await tx.consumptionBudget.findFirst({
        where: { workspaceId: context.workspaceId, resourceType: input.resourceType, resourceKey: input.resourceKey, periodStart: { lte: occurredAt }, periodEnd: { gt: occurredAt } },
        orderBy: { periodStart: "desc" },
      });
      if (!budget) return { allowed: false, code: "BUDGET_NOT_CONFIGURED" as const, budgetId: null, ledgerEntryId: null, warning: false, idempotent: false };
      const aggregate = await totals(tx, context.workspaceId, budget.id);
      const decision = evaluateConsumption({
        status: budget.status, limitCents: budget.limitCents, limitUnits: budget.limitUnits,
        includedCreditCents: budget.includedCreditCents, warningBasisPoints: budget.warningBasisPoints, ...aggregate,
        requestedAmountCents: input.amountCents, requestedUnits: input.units,
      });
      const entry = await tx.consumptionLedgerEntry.create({ data: {
        workspaceId: context.workspaceId, budgetId: budget.id, resourceType: input.resourceType, resourceKey: input.resourceKey,
        kind: decision.allowed ? "DEBIT" : "BLOCKED", amountCents: input.amountCents, units: input.units,
        idempotencyKey: input.idempotencyKey, externalReference: input.externalReference ?? null, reason: decision.allowed ? null : decision.code,
        metadata: json(input.metadata), actorId: context.actorId, occurredAt,
      } });
      if (decision.shouldPause) {
        await tx.consumptionBudget.update({ where: { id: budget.id }, data: { status: "PAUSED", pausedAt: occurredAt, pausedReason: decision.code, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await tx.auditLog.create({ data: {
          workspaceId: context.workspaceId, actorId: context.actorId, action: "consumption.budget.auto_paused", origin: "DOMAIN",
          entityType: "ConsumptionBudget", entityId: budget.id, reason: decision.code,
          changes: serialized({ before: { status: budget.status }, after: { status: "PAUSED" } }),
          metadata: serialized({ resourceType: budget.resourceType, resourceKey: budget.resourceKey, attemptedAmountCents: input.amountCents.toString(), attemptedUnits: input.units.toString() }),
        } });
      }
      return { allowed: decision.allowed, code: decision.code, budgetId: budget.id, ledgerEntryId: entry.id, warning: decision.warning, idempotent: false };
    }, { isolationLevel: "Serializable" });
  }

  async function recordIfConfigured(context: UsagePrincipal, raw: unknown) {
    const input = recordConsumptionSchema.parse(raw);
    const occurredAt = input.occurredAt ?? now();
    const configured = await options.database.consumptionBudget.findFirst({
      where: { workspaceId: context.workspaceId, resourceType: input.resourceType, resourceKey: input.resourceKey, periodStart: { lte: occurredAt }, periodEnd: { gt: occurredAt } },
      select: { id: true },
    });
    if (!configured) return { allowed: true, code: "UNMETERED" as const, budgetId: null, ledgerEntryId: null, warning: false, idempotent: false };
    return record(context, input);
  }

  async function grantCredit(context: AuthenticatedContext, raw: unknown) {
    await options.authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context.workspaceId));
    const input = grantConsumptionCreditSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      const replay = await tx.consumptionLedgerEntry.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay) {
        if (replay.kind !== "CREDIT" || replay.budgetId !== input.budgetId || replay.amountCents !== input.amountCents) {
          fail("A chave idempotente já foi usada com outro crédito.", "CONSUMPTION_IDEMPOTENCY_CONFLICT");
        }
        return { ledgerEntryId: replay.id, idempotent: true };
      }
      const budget = await tx.consumptionBudget.findFirst({ where: { id: input.budgetId, workspaceId: context.workspaceId } });
      if (!budget) fail("Orçamento não encontrado.", "CONSUMPTION_BUDGET_NOT_FOUND", 404);
      const entry = await tx.consumptionLedgerEntry.create({ data: {
        workspaceId: context.workspaceId, budgetId: budget.id, resourceType: budget.resourceType, resourceKey: budget.resourceKey,
        kind: "CREDIT", amountCents: input.amountCents, units: 0n, idempotencyKey: input.idempotencyKey,
        externalReference: input.externalReference ?? null, reason: input.reason, actorId: context.actorId, occurredAt: now(),
      } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "consumption.credit.granted", origin: "DOMAIN", entityType: "ConsumptionLedgerEntry", entityId: entry.id, reason: input.reason, changes: serialized({ after: { budgetId: budget.id, amountCents: input.amountCents.toString() } }) } });
      return { ledgerEntryId: entry.id, idempotent: false };
    }, { isolationLevel: "Serializable" });
  }

  async function setStatus(context: AuthenticatedContext, budgetId: string, status: "ACTIVE" | "PAUSED" | "REVOKED", reason: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context.workspaceId));
    if (reason.trim().length < 3) fail("Informe o motivo da alteração.", "CONSUMPTION_REASON_REQUIRED", 400);
    return options.database.$transaction(async (tx) => {
      const budget = await tx.consumptionBudget.findFirst({ where: { id: budgetId, workspaceId: context.workspaceId } });
      if (!budget) fail("Orçamento não encontrado.", "CONSUMPTION_BUDGET_NOT_FOUND", 404);
      const updated = await tx.consumptionBudget.update({ where: { id: budget.id }, data: { status, pausedAt: status === "PAUSED" ? now() : null, pausedReason: status === "PAUSED" ? reason : null, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: status === "REVOKED" ? "consumption.budget.revoked" : status === "ACTIVE" ? "consumption.budget.resumed" : "consumption.budget.paused", origin: "DOMAIN", entityType: "ConsumptionBudget", entityId: budget.id, reason, changes: serialized({ before: { status: budget.status }, after: { status } }) } });
      return budgetView(updated);
    });
  }

  async function getOverview(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_READ, workspaceResource(context.workspaceId));
    const budgets = await options.database.consumptionBudget.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ resourceType: "asc" }, { resourceKey: "asc" }, { periodStart: "desc" }] });
    return Promise.all(budgets.map(async (budget) => {
      const aggregate = await totals(options.database, context.workspaceId, budget.id);
      const assessment = evaluateConsumption({ status: budget.status, limitCents: budget.limitCents, limitUnits: budget.limitUnits, includedCreditCents: budget.includedCreditCents, warningBasisPoints: budget.warningBasisPoints, ...aggregate, requestedAmountCents: 0n, requestedUnits: 0n });
      return {
        id: budget.id, resourceType: budget.resourceType, resourceKey: budget.resourceKey, status: budget.status,
        currency: budget.currency, periodStart: budget.periodStart.toISOString(), periodEnd: budget.periodEnd.toISOString(),
        limitCents: budget.limitCents?.toString() ?? null, limitUnits: budget.limitUnits?.toString() ?? null,
        includedCreditCents: budget.includedCreditCents.toString(), creditedCents: aggregate.creditedCents.toString(),
        spentCents: aggregate.spentCents.toString(), consumedUnits: aggregate.consumedUnits.toString(),
        availableCents: assessment.availableCents?.toString() ?? null, availableUnits: assessment.availableUnits?.toString() ?? null,
        alert: budget.status !== "ACTIVE" ? budget.status : assessment.warning ? "WARNING" : "NONE",
        pausedReason: budget.pausedReason, revision: budget.revision,
      };
    }));
  }

  async function assertCanConsume(context: UsagePrincipal, resourceType: ConsumptionResourceType, resourceKey: string, amountCents = 0n, units = 0n) {
    const at = now();
    const budget = await options.database.consumptionBudget.findFirst({ where: { workspaceId: context.workspaceId, resourceType, resourceKey, periodStart: { lte: at }, periodEnd: { gt: at } }, orderBy: { periodStart: "desc" } });
    if (!budget) return { allowed: false, code: "BUDGET_NOT_CONFIGURED" as const };
    const aggregate = await totals(options.database, context.workspaceId, budget.id);
    const decision = evaluateConsumption({ status: budget.status, limitCents: budget.limitCents, limitUnits: budget.limitUnits, includedCreditCents: budget.includedCreditCents, warningBasisPoints: budget.warningBasisPoints, ...aggregate, requestedAmountCents: amountCents, requestedUnits: units });
    return { allowed: decision.allowed, code: decision.code };
  }

  return Object.freeze({ configure, record, recordIfConfigured, grantCredit, setStatus, getOverview, assertCanConsume });
}

let singleton: ReturnType<typeof createConsumptionGovernanceService> | undefined;
export function getConsumptionGovernanceService() {
  singleton ??= createConsumptionGovernanceService({ database: getDatabaseClient(), authorization: getAuthorizationService() });
  return singleton;
}
