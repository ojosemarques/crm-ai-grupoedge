import { createHash } from "node:crypto";

import type { AIAssistantProposal, Prisma, PrismaClient } from "@/generated/prisma/client";
import { createCopilotActionsService } from "@/modules/ai-assistant/application/copilot-actions-service";
import { copilotPlanSchema, copilotPlanConfirmationSchema, copilotPlanDecisionSchema, type CopilotPlan, type CopilotPlanPreview } from "@/modules/ai-assistant/domain/copilot-plan-contracts";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { canonicalJson } from "@/modules/integrations/domain/integration-policy";
import { createSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Options = { database: PrismaClient; now: () => Date };
type Link = { label: string; href: string; entityType: string };
type PlanResult = { atomic: true; steps: Array<{ position: number; kind: CopilotPlan["steps"][number]["kind"]; result: unknown; links: Link[] }> };
const lifetimeMs = 30 * 60_000;
const expiredReason = "Prévia expirada; substituída por uma nova solicitação.";
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(json(value))).digest("hex");
const requestText = (value: string) => value.slice(0, 4000).replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, "[SEGREDO_REMOVIDO]").replace(/\b(?:bearer|token|password|senha|secret)\s*[:= ]\s*[^\s,;]+/gi, "[SEGREDO_REMOVIDO]").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL_REMOVIDO]");
function fail(message: string, code: string, statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }

// Domain factories already accept a database port. Nested callbacks must join
// this transaction so their writes, outbox entries and receipts roll back together.
function transactionDatabase(tx: Prisma.TransactionClient): PrismaClient {
  return new Proxy(tx, { get(target, property) {
    if (property === "$transaction") return async (operation: unknown) => {
      if (typeof operation !== "function") throw new Error("Copilot plans require callback transactions.");
      return operation(tx);
    };
    return Reflect.get(target, property);
  } }) as PrismaClient;
}

function stepKey(proposalId: string, position: number) {
  const bytes = hash({ proposalId, position }).slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 3) | 8).toString(16);
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function createCopilotPlanService(options: Options) {
  const adapters = (database: PrismaClient) => ({ actions: createCopilotActionsService({ database, now: options.now }), sales: createSaleCompletionService({ database, now: options.now }) });

  async function authorize(database: PrismaClient, context: AuthenticatedContext) {
    const membership = await database.teamMember.findFirst({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null, team: { deletedAt: null } }, select: { teamId: true }, orderBy: { teamId: "asc" } });
    await createAuthorizationService({ database }).assertAuthorized(context, PermissionKeys.AI_USE, { workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId, ownerMemberId: context.memberId, teamId: membership?.teamId ?? null });
  }

  async function authorizeSteps(database: PrismaClient, context: AuthenticatedContext, plan: CopilotPlan) {
    const services = adapters(database);
    for (const step of plan.steps) {
      if (step.kind === "CLOSE_SALE") await services.sales.authorize(context, step.payload);
      else await services.actions.authorize(context, step);
    }
  }

  async function preview(database: PrismaClient, context: AuthenticatedContext, plan: CopilotPlan): Promise<CopilotPlanPreview> {
    const services = adapters(database);
    const steps: CopilotPlanPreview["steps"] = [];
    for (const [index, step] of plan.steps.entries()) {
      const detail = step.kind === "CLOSE_SALE" ? await services.sales.preview(context, step.payload) : await services.actions.preview(context, step);
      if (step.kind === "CLOSE_SALE" && "customer" in detail && detail.customer?.accountId && plan.steps.some((other) => other.kind === "UPDATE_CUSTOMER" && other.accountId === detail.customer.accountId)) {
        fail("Atualize o cliente primeiro e prepare o fechamento em uma nova prévia.", "COPILOT_PLAN_DEPENDENCY");
      }
      steps.push({ position: index + 1, kind: step.kind, preview: detail });
    }
    return { kind: "ACTION_PLAN", title: "Executar plano de ações", summary: `${steps.length} etapas para uma única confirmação.`, atomic: true, steps, impact: ["Todas as etapas serão executadas na ordem apresentada.", "Se qualquer etapa falhar, nenhuma alteração deste plano será aplicada.", "O plano usa somente registros existentes. Ações sobre cadastros ou cobranças que ainda serão criados exigem uma nova prévia."] };
  }

  function present(row: AIAssistantProposal) {
    return { id: row.id, type: "ACTION_PLAN" as const, revision: row.revision, expiresAt: new Date(row.createdAt.getTime() + lifetimeMs).toISOString(), preview: row.preview as unknown as CopilotPlanPreview, resuming: false };
  }

  async function propose(context: AuthenticatedContext, request: string, raw: unknown) {
    const payload = copilotPlanSchema.parse(raw);
    await authorize(options.database, context);
    const prepared = await preview(options.database, context, payload);
    const fingerprint = hash({ type: "ACTION_PLAN", payload, preview: prepared });
    const row = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`copilot:${context.workspaceId}:${context.actorId}:${fingerprint}`}, 0))`;
      const existing = await tx.aIAssistantProposal.findFirst({ where: { workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: "ACTION_PLAN", status: "DRAFT", requestFingerprint: fingerprint } });
      if (existing && options.now().getTime() - existing.createdAt.getTime() < lifetimeMs) return existing;
      if (existing) {
        await tx.aIAssistantProposal.update({ where: { id: existing.id }, data: { status: "CANCELLED", revision: { increment: 1 }, cancelledAt: options.now(), cancelledByActorId: context.actorId, cancellationReason: expiredReason } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.plan.expired", entityType: "AIAssistantProposal", entityId: existing.id, changes: { domainMutationExecuted: false } } });
      }
      const created = await tx.aIAssistantProposal.create({ data: { workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: "ACTION_PLAN", request: requestText(request), payload: json(payload), preview: json(prepared), diff: json({ steps: payload.steps }), impact: json(prepared.impact), requestFingerprint: fingerprint } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.plan.proposed", entityType: "AIAssistantProposal", entityId: created.id, changes: { stepCount: payload.steps.length, domainMutationExecuted: false } } });
      return created;
    });
    return present(row);
  }

  const lookup = (tx: Prisma.TransactionClient, context: AuthenticatedContext, id: string) => tx.aIAssistantProposal.findFirst({ where: { id, workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: "ACTION_PLAN" } });
  function response(result: PlanResult) {
    const links = [...new Map(result.steps.flatMap((step) => step.links).map((link) => [`${link.entityType}:${link.href}`, link])).values()];
    return { answer: `Plano concluído: ${result.steps.length} etapas executadas conforme sua confirmação.`, result, proposal: null, sources: [], links };
  }

  async function confirm(context: AuthenticatedContext, raw: unknown) {
    const input = copilotPlanConfirmationSchema.parse(raw);
    // A serialization conflict rolls back the complete transaction. One retry
    // reads the concurrent commit/receipt without repeating any committed effect.
    for (let attempt = 0; ; attempt++) {
      try {
        return await options.database.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`copilot-plan:${context.workspaceId}:${input.proposalId}`}, 0))`;
          const database = transactionDatabase(tx);
          await authorize(database, context);
          const row = await lookup(tx, context, input.proposalId);
          if (!row) fail("Plano inexistente ou não autorizado.", "COPILOT_PROPOSAL_NOT_FOUND", 404);
          const payload = copilotPlanSchema.parse(row.payload);
          await authorizeSteps(database, context, payload);
          if (row.status === "PUBLISHED" && row.revision === input.expectedRevision + 1 && row.approvedByActorId === context.actorId) {
            const receipt = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, actorId: context.actorId, entityId: row.id, action: "ai.copilot.plan.executed" } });
            const metadata = receipt?.metadata as { fingerprint?: string; result?: PlanResult } | undefined;
            if (!metadata?.result || metadata.fingerprint !== hash({ payload, preview: row.preview })) fail("O recibo do plano está indisponível. Nenhuma nova execução foi iniciada.", "COPILOT_PLAN_RECEIPT_INVALID");
            return response(metadata.result);
          }
          if (row.status !== "DRAFT" || row.revision !== input.expectedRevision) fail("O plano já foi finalizado ou alterado. Atualize a conversa.", "COPILOT_REVISION_CONFLICT");
          if (options.now().getTime() - row.createdAt.getTime() >= lifetimeMs) fail("O plano expirou. Solicite uma nova prévia.", "COPILOT_PROPOSAL_EXPIRED");
          const prepared = await preview(database, context, payload);
          if (hash(prepared) !== hash(row.preview)) fail("Os dados ou efeitos de uma etapa mudaram. Prepare uma nova prévia; nenhuma etapa foi aplicada.", "COPILOT_PREVIEW_CHANGED");
          const claimed = await tx.aIAssistantProposal.updateMany({ where: { id: row.id, workspaceId: context.workspaceId, status: "DRAFT", revision: input.expectedRevision }, data: { status: "EXECUTING", revision: { increment: 1 }, approvedByActorId: context.actorId, approvedAt: options.now(), approvedReason: "Confirmação explícita de todas as etapas do plano no Copilot." } });
          if (!claimed.count) fail("O plano mudou durante a confirmação.", "COPILOT_REVISION_CONFLICT");
          const services = adapters(database);
          const result: PlanResult = { atomic: true, steps: [] };
          for (const [index, step] of payload.steps.entries()) {
            const expectedPreview = prepared.steps[index]!.preview;
            const idempotencyKey = stepKey(row.id, index + 1);
            if (step.kind === "CLOSE_SALE") {
              if (hash(await services.sales.preview(context, step.payload)) !== hash(expectedPreview)) fail("Uma etapa altera os dados de outra. Prepare planos separados; nenhuma etapa foi aplicada.", "COPILOT_PLAN_DEPENDENCY");
              const completed = await services.sales.execute(context, { ...step.payload, confirmed: true, idempotencyKey });
              result.steps.push({ position: index + 1, kind: step.kind, result: json(completed), links: [{ label: "Contratos", href: "/contratos", entityType: "MODULE" }, { label: "Financeiro", href: "/financeiro", entityType: "MODULE" }] });
            } else {
              const completed = await services.actions.execute(context, step, { confirmed: true, idempotencyKey, expectedPreview });
              result.steps.push({ position: index + 1, kind: step.kind, result: json(completed.result), links: completed.links });
            }
          }
          await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.plan.executed", entityType: "AIAssistantProposal", entityId: row.id, changes: { stepCount: result.steps.length, atomic: true, confirmed: true }, metadata: json({ fingerprint: hash({ payload, preview: row.preview }), result }) } });
          await tx.aIAssistantProposal.update({ where: { id: row.id }, data: { status: "PUBLISHED", publishedTargetType: "CopilotPlan", publishedTargetId: row.id } });
          return response(result);
        }, { isolationLevel: "Serializable", timeout: 60_000 });
      } catch (error) {
        if (attempt === 0 && error && typeof error === "object" && "code" in error && error.code === "P2034") continue;
        throw error;
      }
    }
  }

  async function cancel(context: AuthenticatedContext, raw: unknown) {
    const input = copilotPlanDecisionSchema.parse(raw);
    await authorize(options.database, context);
    await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`copilot-plan:${context.workspaceId}:${input.proposalId}`}, 0))`;
      const row = await lookup(tx, context, input.proposalId);
      if (!row) fail("Plano inexistente ou não autorizado.", "COPILOT_PROPOSAL_NOT_FOUND", 404);
      const cancelled = await tx.aIAssistantProposal.updateMany({ where: { id: row.id, status: "DRAFT", revision: input.expectedRevision }, data: { status: "CANCELLED", revision: { increment: 1 }, cancelledAt: options.now(), cancelledByActorId: context.actorId, cancellationReason: "Plano cancelado pelo solicitante." } });
      if (!cancelled.count) fail("O plano já foi finalizado ou alterado.", "COPILOT_REVISION_CONFLICT");
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.plan.cancelled", entityType: "AIAssistantProposal", entityId: row.id, changes: { domainMutationExecuted: false } } });
    });
    return { answer: "Plano cancelado. Nenhuma etapa foi aplicada.", proposal: null, links: [], sources: [] };
  }

  async function screen(context: AuthenticatedContext) {
    await authorize(options.database, context);
    const rows = await options.database.aIAssistantProposal.findMany({ where: { workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: "ACTION_PLAN" }, orderBy: { createdAt: "desc" }, take: 30 });
    const visible: AIAssistantProposal[] = [];
    for (const row of rows) {
      try { await authorizeSteps(options.database, context, copilotPlanSchema.parse(row.payload)); visible.push(row); }
      catch (error) { if (!(error instanceof ApplicationError && [403, 404].includes(error.statusCode))) throw error; }
    }
    const expired = (row: AIAssistantProposal) => row.status === "DRAFT" && options.now().getTime() - row.createdAt.getTime() >= lifetimeMs;
    return {
      pending: visible.filter((row) => row.status === "DRAFT" && !expired(row)).slice(0, 10).map(present),
      history: visible.map((row) => ({ id: row.id, type: row.type, preview: row.preview, status: expired(row) || row.cancellationReason === expiredReason ? "EXPIRED" : row.status, createdAt: row.createdAt.toISOString(), approvedAt: row.approvedAt?.toISOString() ?? null, cancelledAt: row.cancelledAt?.toISOString() ?? null })),
    };
  }

  return { propose, confirm, cancel, screen };
}

export function getCopilotPlanService() { return createCopilotPlanService({ database: getDatabaseClient(), now: () => new Date() }); }
