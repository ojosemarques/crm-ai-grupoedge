import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { FinanceCommand } from "@/modules/finance/domain/finance-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDayRange } from "@/shared/core/time/workspace-time";
import { reconcileCloserCompensation } from "./closer-compensation-reconciliation";
import { reconcileSdrAdvertisingInTransaction } from "./sdr-advertising-reconciliation";

type Command = Extract<FinanceCommand, { action: "APPROVE_COMPENSATION" | "SETTLE_COMPENSATION" }>;

function reject(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function applyCommercialCompensationCommand(
  database: PrismaClient, context: AuthenticatedContext, command: Command, now: Date,
) {
  const { workspaceId, actorId } = context;
  const where = { workspaceId_obligationKey: { workspaceId, obligationKey: command.obligationKey } };
  const result = await database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-compensation:${workspaceId}`}, 0))`;
    const before = await tx.commercialCompensationObligation.findUnique({ where });
    if (!before) reject("Obrigação não encontrada.", "FINANCE_COMPENSATION_NOT_FOUND", 404);
    const paying = command.action === "SETTLE_COMPENSATION";
    const requestId = paying
      ? `compensation-settle:${digest(command.idempotencyKey)}`
      : `compensation-approve:${digest(`${command.obligationKey}:${command.expectedRevision}`)}`;
    const requestHash = digest(JSON.stringify(command, (_key, value) => typeof value === "bigint" ? value.toString() : value));
    const replay = await tx.auditLog.findFirst({
      where: { workspaceId, requestId, entityType: "CommercialCompensationObligation" }, select: { metadata: true },
    });
    if (replay) {
      if (!replay.metadata || typeof replay.metadata !== "object" || Array.isArray(replay.metadata) || replay.metadata.requestHash !== requestHash) {
        reject("A chave já foi usada com outros dados.", "FINANCE_COMPENSATION_KEY_CONFLICT");
      }
      return { status: before.status, revision: before.revision, replayed: true };
    }
    if (before.revision !== command.expectedRevision) reject("A obrigação mudou. Recarregue o Financeiro.", "FINANCE_COMPENSATION_CONFLICT");
    if (before.kind === "LEGACY_STAGE") reject("A etapa histórica exige conciliação financeira específica.", "FINANCE_COMPENSATION_LEGACY_REVIEW");

    const { timeZone } = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timeZone: true } });
    if (before.kind === "SDR_COMMISSION" || before.kind === "SDR_BONUS") {
      const evaluated = await reconcileSdrAdvertisingInTransaction(tx, workspaceId, timeZone, now, {
        month: before.competenceMonth, memberId: before.sellerMemberId,
      });
      if (!evaluated) return { blocked: true as const };
    } else {
      await reconcileCloserCompensation(tx, workspaceId, now);
    }
    const current = await tx.commercialCompensationObligation.findUniqueOrThrow({ where });
    // Confirme a revisão produzida pela reavaliação antes de permitir outro comando.
    if (current.revision !== before.revision || !current.eligibleAt || !current.dueOn ||
      current.eligibleAt > now || current.status !== (paying ? "APPROVED" : "ELIGIBLE")) {
      return { blocked: true as const };
    }

    let financialEntryId: string | null = null;
    let status: "APPROVED" | "PAID" = "APPROVED";
    if (paying) {
      if (command.settledAt < current.eligibleAt || command.settledAt > now) {
        reject("Informe a data efetiva da baixa entre a elegibilidade e o momento atual.", "FINANCE_COMPENSATION_PAYMENT_DATE", 400);
      }
      const allocated = await tx.commercialCompensationAllocation.aggregate({
        where: { workspaceId, obligationKey: current.obligationKey }, _sum: { amountCents: true },
      });
      const remainingCents = current.amountCents - (allocated._sum.amountCents ?? 0n);
      if (command.amountCents > remainingCents) reject("O valor excede o saldo da obrigação.", "FINANCE_COMPENSATION_PAYMENT_AMOUNT");
      const account = await tx.financialAccount.findFirst({
        where: { workspaceId, id: command.financialAccountId, ...(command.financialEntryId ? {} : { active: true }) },
        select: { id: true, currency: true },
      });
      if (!account || account.currency !== "BRL") reject("Selecione uma conta financeira em reais.", "FINANCE_ACCOUNT_NOT_FOUND", 404);

      if (command.financialEntryId) {
        const entry = await tx.financialEntry.findFirst({
          where: {
            id: command.financialEntryId, workspaceId, financialAccountId: account.id,
            direction: "EXPENSE", status: "SETTLED", currency: "BRL", settledAt: command.settledAt,
            NOT: { idempotencyKey: { startsWith: "finance:commission-payment:" } },
          },
          select: { id: true, amountCents: true, commercialCompensationAllocations: { select: { obligationKey: true, amountCents: true } } },
        });
        if (!entry) reject("Despesa liquidada incompatível com a conta ou a data informada.", "FINANCE_COMPENSATION_ENTRY_NOT_FOUND", 404);
        if (entry.commercialCompensationAllocations.some((item) => item.obligationKey === current.obligationKey) ||
          command.amountCents + entry.commercialCompensationAllocations.reduce((sum, item) => sum + item.amountCents, 0n) > entry.amountCents) {
          reject("A despesa já está vinculada ao título ou não tem saldo disponível.", "FINANCE_COMPENSATION_ENTRY_ALLOCATION");
        }
        financialEntryId = entry.id;
      } else {
        const normalizedReference = command.reference.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
        const idempotencyKey = `finance:compensation-reference:${digest(`${account.id}:${normalizedReference}`)}`;
        const existingEntry = await tx.financialEntry.findUnique({
          where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } }, select: { id: true },
        });
        if (existingEntry) reject("Já existe despesa com esta referência. Vincule o lançamento existente.", "FINANCE_COMPENSATION_REFERENCE_CONFLICT");
        const category = await tx.financialCategory.upsert({
          where: { workspaceId_key: { workspaceId, key: "comissoes_vendas" } },
          create: { workspaceId, key: "comissoes_vendas", name: "Comissões de vendas", kind: "EXPENSE", dreGroup: "despesas_operacionais", createdByActorId: actorId, updatedByActorId: actorId },
          update: {},
        });
        if (category.kind !== "EXPENSE" || !category.active) reject("A categoria de comissões deve estar ativa e ser de despesa.", "FINANCE_CATEGORY_MISMATCH");
        const entry = await tx.financialEntry.create({ data: {
          workspaceId, categoryId: category.id, financialAccountId: account.id, direction: "EXPENSE", status: "SETTLED",
          description: "Baixa de remuneração comercial", amountCents: command.amountCents,
          competenceAt: workspaceDayRange(`${current.competenceMonth}-01`, timeZone).start,
          dueAt: workspaceDayRange(current.dueOn.toISOString().slice(0, 10), timeZone).start,
          settledAt: command.settledAt, idempotencyKey, createdByActorId: actorId, updatedByActorId: actorId,
        } });
        financialEntryId = entry.id;
      }
      await tx.commercialCompensationAllocation.create({ data: {
        workspaceId, obligationKey: current.obligationKey, financialEntryId,
        amountCents: command.amountCents, evidence: `${command.reference} · ${command.evidence}`, recordedById: actorId, recordedAt: now,
      } });
      if (command.amountCents === remainingCents) status = "PAID";
    }

    const updated = await tx.commercialCompensationObligation.update({ where, data: { status, revision: { increment: 1 } } });
    await tx.auditLog.create({ data: {
      workspaceId, actorId, action: paying ? "commercial.compensation.settled" : "commercial.compensation.approved",
      entityType: "CommercialCompensationObligation", entityId: current.sellerMemberId, requestId, occurredAt: now,
      metadata: { requestHash },
      changes: { obligationKey: current.obligationKey, previousStatus: current.status, status, financialEntryId },
    } });
    return { status, revision: updated.revision, replayed: false };
  }, { timeout: 15_000 });
  if ("blocked" in result) reject("A obrigação não atende mais às condições para esta operação. Recarregue a apuração.", "FINANCE_COMPENSATION_REVALIDATION");
  return result;
}
