import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  buildConsultativeRevenueIndicators,
  type ConsultativeRevenueFact,
} from "@/modules/revenue/domain/consultative-revenue-indicators";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

const accessProbe = (context: AuthenticatedContext, resourceType: string) => ({
  workspaceId: context.workspaceId,
  resourceType,
  memberId: context.memberId,
  ownerMemberId: context.memberId,
});

function assertPeriod(from: Date, to: Date, now: Date) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new ApplicationError("Período inválido.", { code: "INVALID_PERIOD", statusCode: 400, expose: true });
  }
  if (from >= to) {
    throw new ApplicationError("O início deve anteceder o fim do período.", { code: "INVALID_PERIOD", statusCode: 400, expose: true });
  }
  if (to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw new ApplicationError("O período máximo para indicadores consultivos é de 366 dias.", { code: "INVALID_PERIOD", statusCode: 400, expose: true });
  }
  if (to > now) {
    throw new ApplicationError("O fim do período não pode estar no futuro.", { code: "INVALID_PERIOD", statusCode: 400, expose: true });
  }
}

export function createConsultativeRevenueIndicatorService(options: Options) {
  async function canRead(
    context: AuthenticatedContext,
    permission: Parameters<AuthorizationPort["authorize"]>[1],
    resourceType: string,
    resourceId: string,
    ownerMemberId: string,
  ) {
    const decision = await options.authorization.authorize(context, permission, {
      workspaceId: context.workspaceId,
      resourceType,
      resourceId,
      ownerMemberId,
    });
    return decision.allowed;
  }

  return {
    async build(context: AuthenticatedContext, from: Date, to: Date) {
      assertPeriod(from, to, options.now());
      await Promise.all([
        options.authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_READ, accessProbe(context, "Opportunity")),
        options.authorization.assertAuthorized(context, PermissionKeys.CONTRACTS_READ, accessProbe(context, "CommercialContract")),
        options.authorization.assertAuthorized(context, PermissionKeys.PAYMENTS_READ, accessProbe(context, "Invoice")),
      ]);

      const [outcomes, contractEvents, invoiceEvents, paymentEvents] = await Promise.all([
        options.database.opportunityOutcomeSnapshot.findMany({
          where: { workspaceId: context.workspaceId, status: "WON", occurredAt: { gte: from, lt: to } },
          select: { id: true, opportunityId: true, ownerMemberId: true, amountCents: true, currency: true, occurredAt: true, createdAt: true },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        }),
        options.database.contractEvent.findMany({
          where: { workspaceId: context.workspaceId, eventType: "ACCEPTED_LOCAL_MANUAL", occurredAt: { gte: from, lt: to }, contractVersionId: { not: null } },
          select: { id: true, contractId: true, contractVersionId: true, occurredAt: true, createdAt: true, idempotencyKey: true },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        }),
        options.database.paymentEvent.findMany({
          where: { workspaceId: context.workspaceId, type: "INVOICE_ISSUED", occurredAt: { gte: from, lt: to }, invoiceId: { not: null } },
          select: { id: true, invoiceId: true, sequence: true, occurredAt: true, recordedAt: true, correlationId: true },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        }),
        options.database.paymentEvent.findMany({
          where: { workspaceId: context.workspaceId, type: { in: ["PAYMENT_CONFIRMED", "PAYMENT_REVERSED", "CHARGEBACK_RECORDED"] }, occurredAt: { gte: from, lt: to }, paymentId: { not: null } },
          select: { id: true, paymentId: true, type: true, sequence: true, occurredAt: true, recordedAt: true, correlationId: true },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        }),
      ]);

      const contractIds = [...new Set(contractEvents.map((event) => event.contractId))];
      const versionIds = [...new Set(contractEvents.flatMap((event) => event.contractVersionId ? [event.contractVersionId] : []))];
      const invoiceIds = [...new Set([
        ...invoiceEvents.flatMap((event) => event.invoiceId ? [event.invoiceId] : []),
      ])];
      const paymentIds = [...new Set(paymentEvents.flatMap((event) => event.paymentId ? [event.paymentId] : []))];

      const [contracts, versions, invoices, payments] = await Promise.all([
        options.database.commercialContract.findMany({
          where: { workspaceId: context.workspaceId, id: { in: contractIds } },
          select: { id: true, ownerMemberId: true },
        }),
        options.database.contractVersion.findMany({
          where: { workspaceId: context.workspaceId, id: { in: versionIds }, currency: "BRL" },
          select: { id: true, contractId: true, totalCents: true },
        }),
        options.database.invoice.findMany({
          where: { workspaceId: context.workspaceId, id: { in: invoiceIds }, currency: "BRL" },
          select: { id: true, ownerMemberId: true, totalCents: true },
        }),
        options.database.payment.findMany({
          where: { workspaceId: context.workspaceId, id: { in: paymentIds }, currency: "BRL" },
          select: { id: true, invoiceId: true, amountCents: true },
        }),
      ]);

      const contractById = new Map(contracts.map((row) => [row.id, row]));
      const versionById = new Map(versions.map((row) => [row.id, row]));
      const invoiceById = new Map(invoices.map((row) => [row.id, row]));
      const paymentById = new Map(payments.map((row) => [row.id, row]));
      const paymentInvoiceIds = [...new Set(payments.map((payment) => payment.invoiceId))];
      const paymentInvoices = await options.database.invoice.findMany({
        where: { workspaceId: context.workspaceId, id: { in: paymentInvoiceIds } },
        select: { id: true, ownerMemberId: true },
      });
      const paymentInvoiceById = new Map(paymentInvoices.map((row) => [row.id, row]));

      const facts: ConsultativeRevenueFact[] = [];
      let unresolvedFactCount = 0;

      for (const outcome of outcomes) {
        if (outcome.currency !== "BRL") { unresolvedFactCount += 1; continue; }
        if (!await canRead(context, PermissionKeys.OPPORTUNITIES_READ, "Opportunity", outcome.opportunityId, outcome.ownerMemberId)) continue;
        facts.push({ factId: outcome.id, semanticKey: `opportunity:${outcome.opportunityId}:won`, kind: "OPPORTUNITY_WON", amountCents: outcome.amountCents, currency: "BRL", occurredAt: outcome.occurredAt, recordedAt: outcome.createdAt, sequence: 1, source: "OpportunityOutcomeSnapshot", sourceEntityId: outcome.opportunityId, correlationId: null });
      }

      for (const event of contractEvents) {
        const contract = contractById.get(event.contractId);
        const version = event.contractVersionId ? versionById.get(event.contractVersionId) : null;
        if (!contract || !version || version.contractId !== event.contractId) { unresolvedFactCount += 1; continue; }
        if (!await canRead(context, PermissionKeys.CONTRACTS_READ, "CommercialContract", contract.id, contract.ownerMemberId)) continue;
        facts.push({ factId: event.id, semanticKey: `contract:${event.contractId}:accepted`, kind: "BOOKING_ACCEPTED", amountCents: version.totalCents, currency: "BRL", occurredAt: event.occurredAt, recordedAt: event.createdAt, sequence: 1, source: "ContractEvent+ContractVersion", sourceEntityId: event.contractId, correlationId: event.idempotencyKey });
      }

      for (const event of invoiceEvents) {
        const invoice = event.invoiceId ? invoiceById.get(event.invoiceId) : null;
        if (!invoice) { unresolvedFactCount += 1; continue; }
        if (!await canRead(context, PermissionKeys.PAYMENTS_READ, "Invoice", invoice.id, invoice.ownerMemberId)) continue;
        facts.push({ factId: event.id, semanticKey: `invoice:${invoice.id}:issued`, kind: "INVOICE_ISSUED", amountCents: invoice.totalCents, currency: "BRL", occurredAt: event.occurredAt, recordedAt: event.recordedAt, sequence: event.sequence, source: "PaymentEvent+Invoice", sourceEntityId: invoice.id, correlationId: event.correlationId });
      }

      for (const event of paymentEvents) {
        const payment = event.paymentId ? paymentById.get(event.paymentId) : null;
        const invoice = payment ? paymentInvoiceById.get(payment.invoiceId) : null;
        if (!payment || !invoice) { unresolvedFactCount += 1; continue; }
        if (!await canRead(context, PermissionKeys.PAYMENTS_READ, "Invoice", invoice.id, invoice.ownerMemberId)) continue;
        const compensation = event.type !== "PAYMENT_CONFIRMED";
        const kind = event.type === "PAYMENT_CONFIRMED"
          ? "PAYMENT_CONFIRMED" as const
          : event.type === "PAYMENT_REVERSED"
            ? "PAYMENT_REVERSED" as const
            : "CHARGEBACK_RECORDED" as const;
        facts.push({
          factId: event.id,
          semanticKey: `payment:${payment.id}:${compensation ? "compensation" : "confirmed"}`,
          kind,
          amountCents: payment.amountCents,
          currency: "BRL",
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
          sequence: event.sequence,
          source: "PaymentEvent+Payment",
          sourceEntityId: payment.id,
          correlationId: event.correlationId,
        });
      }

      const indicators = buildConsultativeRevenueIndicators(facts);
      return Object.freeze({
        period: Object.freeze({ from: from.toISOString(), to: to.toISOString(), semantics: "[from,to)", timeZone: "America/Sao_Paulo" }),
        formulas: Object.freeze({
          won: "Σ OpportunityOutcomeSnapshot.amountCents para status WON",
          bookings: "Σ ContractVersion.totalCents no evento de aceite",
          invoiced: "Σ Invoice.totalCents no evento de emissão",
          netCash: "pagamentos confirmados − reversões − chargebacks",
        }),
        ...indicators,
        quality: Object.freeze({ unresolvedFactCount, hasDivergence: indicators.divergences.length > 0 }),
      });
    },
  };
}

export const getConsultativeRevenueIndicatorService = () => createConsultativeRevenueIndicatorService({
  database: getDatabaseClient(),
  authorization: getAuthorizationService(),
  now: () => new Date(),
});
